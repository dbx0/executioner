import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractJsonResult, type PtyRegistry } from '@exe/pty'
import type { Project } from '@exe/project'
import { newId } from '@exe/protocol'
import { CLAUDE_SESSION_MARKERS } from './agent-env.js'
import type { EventBus } from '../transport/events.js'
import type { ToolsetDeps } from '../mcp/toolset.js'
import { LaunchCleanup, type DeferCleanup } from './launch-cleanup.js'
import { AgentSessionSinks } from '../mcp/agent-sessions.js'
import { HeadlessCliRefused } from './headless-cli.js'

/** What the argv and env builders are told about one headless launch. */
export interface AgentInvocation {
  prompt: string
  headless: boolean
  /** Which CLI adapter to launch (default claude). */
  agent?: string
  /**
   * This run's session id. The agent's scoped token must carry it, since its
   * set_node_output call reaches this run only through it.
   */
  sessionId: string
  /**
   * The node opted in to running a CLI whose own tools cannot be restricted
   * headless (cursor, hermes). Off unless the node sets it.
   */
  allowUnrestrictedCli: boolean
  /** Registers work to run when the agent exits, such as revoking its token. */
  defer: DeferCleanup
}

/** An argv, optionally with environment the same builder prepared for it. */
export type AgentLaunch = string[] | { argv: string[]; env?: Record<string, string> }

export interface AgentRunnerDeps {
  bus: EventBus
  project: Project
  registry: PtyRegistry
  /**
   * Builds the argv (and any environment that goes with it) for the agent
   * process. Injected so tests use a fake agent. Throwing
   * {@link HeadlessCliRefused} fails the node with that message.
   */
  buildArgv: (invocation: AgentInvocation) => AgentLaunch
  /**
   * Optional per-launch environment for the agent process (e.g. the project
   * MCP config for agents that read it from an env var). Optional so tests that
   * only exercise argv can omit it.
   */
  buildEnv?: (invocation: AgentInvocation) => Record<string, string> | undefined
  /**
   * The MCP toolset's deps object. The runner binds this run's session in its
   * `sessions` for the duration of the run, so only a `set_node_output` call
   * made with this run's token lands here, then unbinds it.
   */
  toolsetDeps: ToolsetDeps
}

export interface AgentAutoInput {
  nodeId: string
  executionId: string
  prompt: string
  /** Which agent CLI to run (default claude). */
  agent?: string
  /** See {@link AgentInvocation.allowUnrestrictedCli}. Default false. */
  allowUnrestrictedCli?: boolean
}

export interface AgentAutoOutput {
  parsed: Array<Record<string, unknown>>
  transcript: string
}

/**
 * Runs an agent node headlessly through a PTY: stream output, collect the full
 * transcript, and capture the agent's structured result via the MCP
 * `set_node_output` tool call, which reaches this run only from its own session.
 * If the agent makes no such call, falls back to legacy fenced ```json
 * extraction from the transcript. A missing or unparseable result errors the
 * node rather than passing junk on.
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  runAuto(input: AgentAutoInput): Promise<AgentAutoOutput> {
    const { bus, project, registry, buildArgv, buildEnv, toolsetDeps } = this.deps
    const { nodeId, executionId, prompt, agent } = input
    const runDir = project.evidenceDir(executionId)

    return new Promise((resolve) => {
      const cleanup = new LaunchCleanup()
      const sessionId = newId()
      const invocation: AgentInvocation = {
        prompt,
        headless: true,
        ...(agent === undefined ? {} : { agent }),
        sessionId,
        allowUnrestrictedCli: input.allowUnrestrictedCli === true,
        defer: cleanup.defer,
      }
      let transcript = ''
      let captured: Record<string, unknown> | undefined

      bus.publish({ type: 'status', executionId, nodeId, data: 'running' })

      const sessions = (toolsetDeps.sessions ??= new AgentSessionSinks())
      cleanup.defer(
        sessions.bind(sessionId, {
          nodeOutput: (data) => {
            captured = data
          },
        }),
      )

      let session: ReturnType<PtyRegistry['create']>
      try {
        // The builders issue the run's token and write its config, so a throw
        // anywhere from here to the spawn must still revoke and remove them.
        const launch = buildArgv(invocation)
        const argv = Array.isArray(launch) ? launch : launch.argv
        const launchEnv = Array.isArray(launch) ? undefined : launch.env
        const injectedEnv = buildEnv?.(invocation)
        const spawnEnv =
          launchEnv === undefined && injectedEnv === undefined ? undefined : { ...launchEnv, ...injectedEnv }
        const [command, ...args] = argv
        session = registry.create(newId(), {
          command: command ?? process.execPath,
          args,
          cwd: runDir,
          unsetEnv: CLAUDE_SESSION_MARKERS,
          ...(spawnEnv !== undefined ? { env: spawnEnv } : {}),
        })
      } catch (error) {
        cleanup.run()
        if (!(error instanceof HeadlessCliRefused)) throw error
        // A CLI this node may not run headless: fail the node with the reason
        // where the operator reads its output, rather than the whole run.
        const message = `${error.message}\n`
        writeFileSync(join(runDir, `${nodeId}.transcript`), message)
        bus.publish({ type: 'stderr', executionId, nodeId, data: message })
        bus.publish({ type: 'status', executionId, nodeId, data: 'failed' })
        bus.publish({ type: 'done', executionId, nodeId, data: '' })
        resolve({ parsed: [], transcript: message })
        return
      }

      session.onData((data) => {
        transcript += data
        bus.publish({ type: 'stdout', executionId, nodeId, data })
      })

      session.onExit(() => {
        // The agent is gone, so its session, token and config files go with it.
        cleanup.run()

        writeFileSync(join(runDir, `${nodeId}.transcript`), transcript)

        let parsed: Array<Record<string, unknown>>
        if (captured !== undefined) {
          parsed = [captured]
        } else {
          const fallback = extractJsonResult(transcript)
          parsed = fallback === undefined ? [] : [fallback]
        }

        bus.publish({ type: 'status', executionId, nodeId, data: parsed.length > 0 ? 'succeeded' : 'failed' })
        bus.publish({ type: 'done', executionId, nodeId, data: '' })
        resolve({ parsed, transcript })
      })
    })
  }
}
