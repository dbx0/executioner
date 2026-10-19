import { createWriteStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@exe/project'
import type { Target, ToolManifest } from '@exe/protocol'
import { buildArgv, extractRecords, applyEmit, type EmitContext, type ParseSpec } from '@exe/nodes'
import type { EventBus } from '../transport/events.js'
import type { CancellationRegistry } from './cancellation.js'
import { createStreamThrottle } from '../transport/stream-throttle.js'
import { LocalLauncher, type CommandLauncher } from '../infra/launcher.js'

export interface NodeRunnerDeps {
  bus: EventBus
  project: Project
  /** Lets a stop kill this node's child process instead of waiting it out. */
  runs?: CancellationRegistry
}

export interface NodeRunInput {
  manifest: ToolManifest
  params: Record<string, unknown>
  target: Target
  executionId: string
  nodeId: string
  /** Where this node's command runs. Defaults to local. */
  launcher?: CommandLauncher
  /** Overrides the manifest's timeout for this node (ms), when set. */
  timeoutMs?: number
  /** When false, the node runs and returns parsed rows for downstream nodes but
   *  does NOT persist its emitted targets/facts to the project (the per-node
   *  "don't save" flag). Defaults to true. */
  persist?: boolean
}

export interface NodeRunOutput {
  output: string
  rows: Array<Record<string, unknown>>
  status: string
  exitCode: number | null
}

/**
 * Runs a single node against a single target as a local child process, mirroring
 * `Executor.start`'s spawn/stream/evidence/emit logic. This is a standalone
 * primitive used by the graph executor; it does not touch any execution store,
 * since recording node results is the caller's responsibility.
 */
export class NodeRunner {
  constructor(private readonly deps: NodeRunnerDeps) {}

  run(input: NodeRunInput): Promise<NodeRunOutput> {
    const { manifest, params, target, executionId, nodeId } = input
    const { bus, project } = this.deps
    const dir = project.evidenceDir(executionId)
    const stdoutPath = join(dir, `${nodeId}.stdout`)
    const stderrPath = join(dir, `${nodeId}.stderr`)

    return new Promise<NodeRunOutput>((resolve) => {
      let argv
      try {
        argv = buildArgv(manifest, { target, params })
      } catch {
        resolve({ output: '', rows: [], status: 'failed', exitCode: null })
        return
      }

      // A node whose output is parsed from a FILE can't run on a remote backend
      // yet (we don't retrieve remote files), so it falls back to local. Nodes
      // that parse stdout/stderr run wherever the chosen backend points.
      const requested = input.launcher ?? new LocalLauncher()
      const launcher =
        requested.kind !== 'local' && manifest.emit.parser === 'file' ? new LocalLauncher() : requested
      if (launcher !== requested) {
        bus.publish({
          type: 'stderr',
          executionId,
          nodeId,
          data: `[executioner] "${manifest.id}" reads a file output, so it runs locally under the ${requested.kind} backend.\n`,
        })
      }

      const child = launcher.launch({ program: argv.program, args: argv.args, cwd: dir })
      // Stopping a run has to reach the process that is actually running, or a
      // long scan would keep going until its own timeout. Same escalation as the
      // timeout path; released the moment this node settles, so a later stop
      // never signals a process this node no longer owns.
      let cancelled = false
      const releaseCancel =
        this.deps.runs?.onCancel(executionId, () => {
          cancelled = true
          child.kill('SIGTERM')
          setTimeout(() => child.kill('SIGKILL'), 2000).unref()
        }) ?? ((): void => {})
      // No node feeds a tool on stdin, but spawn leaves it an open pipe. Tools
      // that accept targets on stdin (katana and the other ProjectDiscovery ones)
      // then block forever waiting for EOF, producing nothing until the timeout
      // kills them. Closing it immediately is what makes them run at all.
      child.stdin.end()

      const stdoutFile = createWriteStream(stdoutPath)
      const stderrFile = createWriteStream(stderrPath)
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      // Coalesce output so a chatty tool doesn't flood the /events socket.
      const stdoutStream = createStreamThrottle({ bus, type: 'stdout', executionId, nodeId })
      const stderrStream = createStreamThrottle({ bus, type: 'stderr', executionId, nodeId })
      let timedOut = false
      // A failed spawn emits BOTH 'error' and 'close' (with the errno as the
      // code). Only the first of them may settle the run, or the diagnostic gets
      // overwritten by a meaningless exit code.
      let settled = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      }, input.timeoutMs !== undefined && input.timeoutMs > 0 ? input.timeoutMs : manifest.command.timeout_ms)

      child.stdout.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8')
        stdoutChunks.push(text)
        stdoutFile.write(text)
        stdoutStream.push(text)
      })
      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8')
        stderrChunks.push(text)
        stderrFile.write(text)
        stderrStream.push(text)
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        releaseCancel()
        stdoutStream.flush()
        stderrStream.flush()

        const stdout = stdoutChunks.join('')
        const stderr = stderrChunks.join('')
        bus.publish({ type: 'status', executionId, nodeId, data: String(code) })

        const finish = (): void => {
          // A stop reads before a timeout: killing the child is how a stop
          // works, so its SIGTERM must not be reported as the tool timing out.
          if (cancelled) {
            bus.publish({ type: 'done', executionId, nodeId, data: 'cancelled' })
            resolve({ output: stdout, rows: [], status: 'cancelled', exitCode: code })
            return
          }
          if (timedOut) {
            bus.publish({ type: 'done', executionId, nodeId, data: 'timeout' })
            resolve({ output: stdout, rows: [], status: 'timeout', exitCode: code })
            return
          }
          if (code !== 0) {
            bus.publish({ type: 'done', executionId, nodeId, data: 'failed' })
            resolve({ output: stdout, rows: [], status: 'failed', exitCode: code })
            return
          }
          try {
            const rows = this.applyOutput(
              manifest,
              target,
              params,
              executionId,
              nodeId,
              { stdout, stderr, dir },
              input.persist ?? true,
            )
            bus.publish({ type: 'done', executionId, nodeId, data: 'succeeded' })
            resolve({ output: stdout, rows, status: 'succeeded', exitCode: code })
          } catch {
            bus.publish({ type: 'done', executionId, nodeId, data: 'failed' })
            resolve({ output: stdout, rows: [], status: 'failed', exitCode: code })
          }
        }

        // Settle only once BOTH evidence files are closed. end() flushes
        // asynchronously, so resolving before that hands the caller a node result
        // whose .stdout/.stderr files are still short — and those files are what
        // the runs view reads back.
        let pendingFiles = 2
        const whenFlushed = (): void => {
          pendingFiles -= 1
          if (pendingFiles === 0) finish()
        }
        stdoutFile.once('close', whenFlushed)
        stderrFile.once('close', whenFlushed)
        stdoutFile.end()
        stderrFile.end()
      })

      // A spawn failure — overwhelmingly a tool that isn't installed on the
      // backend this run chose — produces no output of its own. Say so instead of
      // recording an empty stdout, an empty stderr and a null exit code, which
      // reads exactly like a process that was killed.
      child.on('error', (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        releaseCancel()
        const message = `[executioner] could not run "${argv.program}" on the ${launcher.kind} backend: ${err.message}\n`
        stderrChunks.push(message)
        stdoutFile.end()
        bus.publish({ type: 'stderr', executionId, nodeId, data: message })
        bus.publish({ type: 'done', executionId, nodeId, data: 'failed' })
        // Resolve only once the message is on disk: createWriteStream opens
        // lazily, so anything written around it can be truncated by the open.
        stderrFile.once('close', () => {
          resolve({ output: '', rows: [], status: 'failed', exitCode: null })
        })
        stderrFile.end(message)
      })
    })
  }

  /** Parse output per the manifest and apply emitted targets/facts. Returns the parsed records. */
  private applyOutput(
    manifest: ToolManifest,
    target: Target,
    params: Record<string, unknown>,
    executionId: string,
    nodeId: string,
    output: { stdout: string; stderr: string; dir: string },
    persist: boolean,
  ): Array<Record<string, unknown>> {
    const emit = manifest.emit
    let input: string
    if (emit.parser === 'file') {
      input = readFileSync(join(output.dir, emit.path as string), 'utf8')
    } else {
      input = emit.source === 'stderr' ? output.stderr : output.stdout
    }

    const spec: ParseSpec = { parser: emit.parser, records: emit.records }
    if (emit.pattern !== undefined) spec.pattern = emit.pattern
    if (emit.format !== undefined) spec.format = emit.format
    const records = extractRecords(spec, input)
    const ctx: EmitContext = {
      target: { id: target.id, kind: target.kind, value: target.value },
      params,
      nodeId,
      executionId,
    }
    const { targets, facts } = applyEmit(records, emit, ctx)

    // The per-node save flag: still return parsed rows for downstream nodes, but
    // skip writing this node's targets/facts to the project.
    if (!persist) return records

    for (const spec of targets) {
      this.deps.project.targets.upsert({
        kind: spec.kind,
        value: spec.value,
        source: spec.source,
        parentId: spec.parentId,
      })
    }
    if (facts.length > 0) {
      this.deps.project.facts.recordMany(
        facts.map((f) => ({
          targetId: f.targetId,
          kind: f.kind,
          executionId: f.executionId,
          nodeId: f.nodeId,
          data: f.data,
        })),
      )
    }

    return records
  }
}
