import type { PtyRegistry } from '@exe/pty'
import { newId } from '@exe/protocol'
import { CLAUDE_SESSION_MARKERS } from './agent-env.js'
import type { ToolsetDeps, WorkflowProposal } from '../mcp/toolset.js'
import { LaunchCleanup, type DeferCleanup } from './launch-cleanup.js'
import { AgentSessionSinks } from '../mcp/agent-sessions.js'

export interface AssistantRunInput {
  prompt: string
  /** Which agent CLI to run (default claude). */
  agent?: string
  /** The agent's own session id from a prior turn, to resume the conversation. */
  sessionId?: string
  /** The live canvas graph this turn edits, returned by get_workflow_graph. */
  graph?: unknown
}

export interface AssistantRunResult {
  /** The assistant's reply text. */
  reply: string
  /** The agent's session id for resuming next turn (Claude only). */
  sessionId?: string
  /** The proposal captured via the propose_workflow MCP tool, if any. */
  proposal?: WorkflowProposal
}

export interface AssistantRunnerDeps {
  registry: PtyRegistry
  /**
   * The shared MCP toolset deps. The runner binds this turn's session in its
   * `sessions` for the duration of a run, so only a propose_workflow call made
   * with this turn's token is captured and get_workflow_graph returns this
   * turn's canvas, then unbinds it (mirrors AgentRunner).
   */
  toolsetDeps: ToolsetDeps
  /** Working directory the agent runs in (the project root). */
  cwd: string
  /**
   * Builds the argv for the agent process. Injected so tests use a fake agent.
   * `resume` carries the prior session id when continuing a conversation,
   * `sessionId` is this turn's session (its scoped token must carry it), and
   * `defer` registers work to run when the agent exits.
   */
  buildArgv: (invocation: {
    prompt: string
    agent: string
    resume?: string
    sessionId: string
    defer: DeferCleanup
  }) => string[]
}

/** Strip ANSI escapes a PTY may interleave with the JSON payload. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*[A-Za-z]/g

/**
 * Parse Claude's `-p --output-format json` stdout into its reply text and
 * session id. Claude prints a single JSON object like
 * `{ type: 'result', result: '<text>', session_id: '<uuid>' }`. A PTY may add
 * carriage returns/ANSI, so we locate the outermost {...} and parse that.
 */
export function parseClaudeJson(stdout: string): { reply: string; sessionId?: string } {
  const clean = stdout.replace(ANSI, '')
  const open = clean.indexOf('{')
  const close = clean.lastIndexOf('}')
  if (open !== -1 && close > open) {
    try {
      const obj = JSON.parse(clean.slice(open, close + 1)) as {
        result?: unknown
        session_id?: unknown
      }
      const reply = typeof obj.result === 'string' ? obj.result : ''
      const sessionId = typeof obj.session_id === 'string' ? obj.session_id : undefined
      return sessionId === undefined ? { reply } : { reply, sessionId }
    } catch {
      // fall through to raw text
    }
  }
  return { reply: clean.trim() }
}

/**
 * Spawns the selected agent headless (through a PTY) to answer one assistant
 * turn. Wires the proposal sink so a `propose_workflow` MCP call is captured,
 * collects the reply text, and (for Claude) the resume/session id.
 *
 * Codex is best-effort: `codex exec` runs headless and its stdout is taken as
 * the reply, but Codex does not speak our `--mcp-config` toolset, so it cannot
 * call propose_workflow — Codex advises, proposal capture is Claude-only.
 */
export class AssistantRunner {
  constructor(private readonly deps: AssistantRunnerDeps) {}

  run(input: AssistantRunInput): Promise<AssistantRunResult> {
    const { registry, toolsetDeps, cwd, buildArgv } = this.deps
    const agent = input.agent ?? 'claude'

    return new Promise((resolve) => {
      const cleanup = new LaunchCleanup()
      const sessionId = newId()
      let stdout = ''
      let proposal: WorkflowProposal | undefined
      const sessions = (toolsetDeps.sessions ??= new AgentSessionSinks())
      cleanup.defer(
        sessions.bind(sessionId, {
          proposal: (p) => {
            proposal = p
          },
          ...(input.graph === undefined ? {} : { graph: input.graph }),
        }),
      )

      let session: ReturnType<PtyRegistry['create']>
      try {
        // buildArgv issues the turn's token and writes its config, so a throw
        // anywhere from here to the spawn must still revoke and remove them.
        const argv = buildArgv({
          prompt: input.prompt,
          agent,
          ...(input.sessionId === undefined || input.sessionId === '' ? {} : { resume: input.sessionId }),
          sessionId,
          defer: cleanup.defer,
        })
        const [command, ...args] = argv
        session = registry.create(newId(), {
          command: command ?? process.execPath,
          args,
          cwd,
          unsetEnv: CLAUDE_SESSION_MARKERS,
        })
      } catch (error) {
        cleanup.run()
        throw error
      }
      session.onData((data) => {
        stdout += data
      })
      session.onExit(() => {
        // The turn is over: its session, token and config files go with it.
        cleanup.run()

        const { reply, sessionId } =
          agent === 'claude' ? parseClaudeJson(stdout) : { reply: stdout.replace(ANSI, '').trim(), sessionId: undefined }

        resolve({
          reply,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(proposal === undefined ? {} : { proposal }),
        })
      })
    })
  }
}
