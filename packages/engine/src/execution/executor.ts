import { type ChildProcess } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@exe/project'
import type { Target, ToolManifest } from '@exe/protocol'
import { NodeExecutionStatus } from '@exe/protocol'
import { buildArgv, extractRecords, applyEmit, type EmitContext, type ParseSpec } from '@exe/nodes'
import type { ExecutionSummary } from '@exe/db'
import type { EventBus } from '../transport/events.js'
import { createStreamThrottle } from '../transport/stream-throttle.js'
import { LocalLauncher, type CommandLauncher } from '../infra/launcher.js'
import type { CancellationRegistry } from './cancellation.js'

export interface StartResult {
  executionId: string
  settled: Promise<ExecutionSummary>
}

/** Options for one standalone run. Everything here is optional — omitted, the
 *  run behaves exactly as it did before connections were selectable. */
export interface StartOptions {
  /** Where to run. Defaults to this machine. */
  launcher?: CommandLauncher
  /** The saved connection `launcher` was built from, recorded for replay. */
  backendProfileId?: string
  /** Persisted with the run so the Tools page can repeat it. */
  params?: Record<string, unknown>
}

/**
 * Runs one node against one target as a child process. There is no shell: argv
 * is built token by token. stdout and stderr are streamed to the event bus and
 * teed to the evidence directory; on a clean exit the manifest's emit block
 * turns output into targets and facts. Live children are tracked so a server
 * shutdown can kill them.
 *
 * The run executes wherever the given launcher points (this machine by
 * default, or a saved SSH/Docker connection) — the same launcher abstraction
 * the graph executor's NodeRunner uses, so a node behaves identically whether
 * a workflow or the Tools page started it.
 *
 * `runs` is optional. Given one, the run is registered so
 * `POST /executions/:id/cancel` can actually kill it; omitted, nothing is
 * registered and the executor behaves as it always has. It is NOT defaulted to
 * a private registry: that would leave cancel unable to find the run while
 * looking like it worked.
 */
export class Executor {
  private readonly children = new Map<string, ChildProcess>()

  constructor(
    private readonly project: Project,
    private readonly bus: EventBus,
    private readonly runs?: CancellationRegistry,
  ) {}

  start(
    manifest: ToolManifest,
    target: Target,
    params: Record<string, unknown>,
    options: StartOptions = {},
  ): StartResult {
    // A node whose output is parsed from a FILE cannot run on a remote backend:
    // the file lands in the remote working directory, where nothing reads it.
    // Nodes that parse stdout/stderr run wherever the chosen backend points.
    const requested = options.launcher ?? new LocalLauncher()
    const launcher =
      requested.kind !== 'local' && manifest.emit.parser === 'file' ? new LocalLauncher() : requested

    const executionId = this.project.executions.create({
      targetId: target.id,
      nodeId: manifest.id,
      backend: launcher.kind,
      // A file-output node forced local did not run on the profile, so it is
      // not recorded against it.
      ...(options.backendProfileId !== undefined && launcher === requested
        ? { backendProfileId: options.backendProfileId }
        : {}),
      ...(options.params !== undefined ? { params: options.params } : {}),
    })
    this.runs?.register(executionId)
    const dir = this.project.evidenceDir(executionId)
    const stdoutPath = join(dir, 'stdout.log')
    const stderrPath = join(dir, 'stderr.log')

    if (launcher !== requested) {
      this.bus.publish({
        type: 'stdout',
        executionId,
        nodeId: manifest.id,
        data: `[executioner] "${manifest.id}" reads a file output, so it runs locally under the ${requested.kind} backend.\n`,
      })
    }

    const settled = new Promise<ExecutionSummary>((resolve) => {
      let argv
      try {
        argv = buildArgv(manifest, { target, params })
      } catch (error) {
        this.project.executions.finish(executionId, {
          status: NodeExecutionStatus.Failed,
          exitCode: null,
          stdoutPath: null,
          stderrPath: null,
          parsed: [],
          error: (error as Error).message,
        })
        this.bus.publish({ type: 'done', executionId, nodeId: manifest.id, data: 'failed' })
        resolve(this.project.executions.get(executionId)!)
        return
      }

      const child = launcher.launch({ program: argv.program, args: argv.args, cwd: dir })
      // Same reason as NodeRunner: an open stdin pipe hangs any tool that reads
      // targets from stdin.
      child.stdin.end()
      this.children.set(executionId, child)
      // Stop has to kill what is running right now; without this hook it would
      // only take effect once the tool finished on its own, which for a long
      // scan is no stop at all. Released the moment the child settles, so a
      // later stop can never kill a finished run's process.
      const releaseKill =
        this.runs?.onCancel(executionId, () => {
          child.kill('SIGTERM')
          setTimeout(() => child.kill('SIGKILL'), 2000).unref()
        }) ?? ((): void => {})

      const stdoutFile = createWriteStream(stdoutPath)
      const stderrFile = createWriteStream(stderrPath)
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      // Coalesce chatty tool output so a burst doesn't flood the /events socket
      // and freeze the client. The full text is still written to the log files
      // and collected in *Chunks for applyOutput.
      const stdoutStream = createStreamThrottle({ bus: this.bus, type: 'stdout', executionId, nodeId: manifest.id })
      const stderrStream = createStreamThrottle({ bus: this.bus, type: 'stderr', executionId, nodeId: manifest.id })
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      }, manifest.command.timeout_ms)

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

      // A failed spawn emits BOTH 'error' and 'close', so without this guard a
      // run would be finished twice — writing the row again after the caller
      // has already seen it settle.
      let done = false
      const settle = (
        status: NodeExecutionStatus,
        exitCode: number | null,
        parsed: Array<Record<string, unknown>>,
        error: string | null,
      ) => {
        if (done) return
        done = true
        releaseKill()
        this.runs?.unregister(executionId)
        this.project.executions.finish(executionId, {
          status,
          exitCode,
          stdoutPath,
          stderrPath,
          parsed,
          error,
        })
        this.bus.publish({ type: 'done', executionId, nodeId: manifest.id, data: status })
        resolve(this.project.executions.get(executionId)!)
      }

      child.on('close', (code) => {
        clearTimeout(timer)
        this.children.delete(executionId)
        stdoutStream.flush()
        stderrStream.flush()
        stdoutFile.end()
        stderrFile.end()
        this.bus.publish({ type: 'status', executionId, nodeId: manifest.id, data: String(code) })

        if (timedOut) {
          settle(NodeExecutionStatus.Timeout, code, [], 'timed out')
          return
        }
        if (code !== 0) {
          settle(NodeExecutionStatus.Failed, code, [], `process exited ${code}`)
          return
        }

        try {
          const records = this.applyOutput(manifest, target, params, executionId, {
            stdout: stdoutChunks.join(''),
            stderr: stderrChunks.join(''),
            dir,
          })
          settle(NodeExecutionStatus.Succeeded, code, records, null)
        } catch (error) {
          settle(NodeExecutionStatus.Failed, code, [], (error as Error).message)
        }
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        this.children.delete(executionId)
        stdoutFile.end()
        stderrFile.end()
        // "nmap: not found" out of an ssh session is indistinguishable from the
        // tool itself failing, so say which backend could not run it.
        const message =
          launcher.kind === 'local'
            ? error.message
            : `could not run "${argv.program}" on the ${launcher.kind} backend: ${error.message}`
        settle(NodeExecutionStatus.Failed, null, [], message)
      })
    })

    return { executionId, settled }
  }

  /** Parse output per the manifest and apply emitted targets/facts. Returns the
   *  parsed records, which the run keeps as its output the way a workflow node does. */
  private applyOutput(
    manifest: ToolManifest,
    target: Target,
    params: Record<string, unknown>,
    executionId: string,
    output: { stdout: string; stderr: string; dir: string },
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
      nodeId: manifest.id,
      executionId,
    }
    const { targets, facts } = applyEmit(records, emit, ctx)

    for (const spec of targets) {
      this.project.targets.upsert({
        kind: spec.kind,
        value: spec.value,
        source: spec.source,
        parentId: spec.parentId,
      })
    }
    if (facts.length > 0) {
      this.project.facts.recordMany(
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

  /** Kill every live child. Used on server shutdown. */
  stopAll(): void {
    for (const child of this.children.values()) {
      child.kill('SIGKILL')
    }
    this.children.clear()
  }
}
