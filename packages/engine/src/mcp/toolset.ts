import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { z } from 'zod'
import {
  canonicaliseAsset,
  evaluateScope,
  isCanonicalAsset,
  scopeEffectSchema,
  scopePatternProblem,
  targetKindSchema,
  type BackendProfile,
  type ScopeRule,
  type ToolManifest,
} from '@exe/protocol'
import { graphSchema, validateGraph } from '@exe/graph'
import { writeProgramDescription, type Project } from '@exe/project'
import { launcherForProfile, type CommandLauncher } from '../infra/launcher.js'
import { buildNodeTypes } from './node-types.js'
import { normaliseScopePattern, type RunRepository } from '@exe/db'
import type { AgentSessionSinks, ScopeDraftSink } from './agent-sessions.js'

export interface RunWorkflowFn {
  (workflowId: string, targetId: string): Promise<{ executionId: string; status: 'success' | 'error' }>
}

/** A proposal captured from the assistant's propose_workflow call. */
export interface WorkflowProposal {
  name?: string
  graph: unknown
  summary: string
}

export interface ToolsetDeps {
  project: Project
  runWorkflow: RunWorkflowFn
  /**
   * Where each headless run's set_node_output, propose_workflow and
   * get_workflow_graph calls land, keyed by the calling token's session. The
   * runners bind a session for the length of one run; a call from any other
   * session, or from a caller with none, reaches no run.
   */
  sessions?: AgentSessionSinks
  /** Supplies the engine tool manifests for list_node_types (bundled + custom). */
  manifests?: () => ToolManifest[]
  /** Backs list_executions/get_execution so the assistant can diagnose runs. */
  executionStore?: RunRepository
  /** Builds the launcher for a resolved backend profile. Injectable for tests;
   *  defaults to {@link launcherForProfile}. */
  launcherFactory?: (profile: BackendProfile | undefined) => CommandLauncher
  /** Hard timeout for run_command (ms). Defaults to 120s. */
  commandTimeoutMs?: number
}

/**
 * Who is making an MCP call, from the scoped token it presented. Empty for the
 * engine's master token.
 */
export interface ToolCaller {
  profile?: AgentProfile
  sessionId?: string
}

/**
 * The `source` a target gets when a headless agent records it. It shows on the
 * target so the operator can tell it apart, and the engine does not fire
 * `on_create` schedules for it: a headless agent reads target output nobody
 * vets, so a prompt injection could otherwise pick a target and launch saved
 * workflows at it.
 */
export const HEADLESS_AGENT_TARGET_SOURCE = 'headless-agent'

/** Whether creating a target from `source` may fire `on_create` schedules. */
export function firesOnCreate(source: string): boolean {
  return source !== HEADLESS_AGENT_TARGET_SOURCE
}

function isHeadless(caller: ToolCaller): boolean {
  return caller.profile !== undefined && caller.profile !== 'interactive'
}

/** run_command's structured result. */
export interface RunCommandResult {
  stdout: string
  stderr: string
  exit_code: number | null
  backend: string
}

const upsertArgs = z.object({ kind: targetKindSchema, value: z.string().min(1), parent: z.string().optional() })
// The target is optional: an agent may prove something before it knows which
// asset owns it, and a finding outlives the target it was found on.
const findingArgs = z.object({
  target: z.string().min(1).optional(),
  severity: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  details: z.string().optional(),
})
const updateFindingArgs = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  severity: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  description: z.string().optional(),
  details: z.string().optional(),
})
const listFindingArgs = z.object({ status: z.string().optional(), severity: z.string().optional() })
const runArgs = z.object({ workflowId: z.string().min(1), targetId: z.string().min(1) })
const getArgs = z.object({ value: z.string().min(1) })
const scopeRuleArgs = z.object({
  effect: scopeEffectSchema,
  pattern: z.string().min(1),
  note: z.string().optional(),
})
const programArgs = z.object({ markdown: z.string().min(1) })
const nodeOutputArgs = z.object({ data: z.record(z.string(), z.unknown()) })
const proposeArgs = z.object({ name: z.string().optional(), graph: z.unknown(), summary: z.string().min(1) })
const runCommandArgs = z.object({ command: z.string().min(1), backend: z.string().optional() })

/**
 * What a project MCP tool can do, which decides who may call it.
 * - `read`: returns project state and changes nothing.
 * - `record`: writes data into the engagement (targets, findings, scope rules,
 *   the program description) or hands a result to the caller (node output, a
 *   workflow proposal the operator reviews). Nothing runs.
 * - `dangerous`: starts processes on this machine or a backend. A prompt
 *   injection that reaches one of these runs code, so only an agent the
 *   operator is watching gets them.
 */
export type ToolAccess = 'read' | 'record' | 'dangerous'

export const TOOL_ACCESS = {
  list_targets: 'read',
  get_target: 'read',
  list_scope_rules: 'read',
  list_findings: 'read',
  list_workflows: 'read',
  list_executions: 'read',
  get_execution: 'read',
  list_node_types: 'read',
  get_workflow_graph: 'read',
  // Ids, hosts and env key names only; secrets never leave the store.
  list_backends: 'read',
  upsert_target: 'record',
  add_scope_rule: 'record',
  // Writes one file at a fixed name inside the engagement.
  set_program_description: 'record',
  add_finding: 'record',
  update_finding: 'record',
  set_node_output: 'record',
  // Only captured for the operator to review and apply.
  propose_workflow: 'record',
  // sh -lc on the local machine or a saved backend.
  run_command: 'dangerous',
  // Runs a saved workflow's tool and script nodes.
  run_workflow: 'dangerous',
} as const satisfies Record<string, ToolAccess>

export type ToolName = keyof typeof TOOL_ACCESS

/**
 * Who an agent session is, which fixes the tools it may call.
 * - `interactive`: a terminal the operator opened and watches. Every tool; the
 *   agent CLI's own permission prompts still apply.
 * - `workflow`: a headless agent node. Reads, plus reporting its result and
 *   what it found.
 * - `assistant`: the headless workflow assistant. Reads, plus proposing a graph.
 * - `scope`: the headless scope parser. Reads, plus recording the scope.
 * Headless agents read attacker-influenced tool output with nobody approving
 * their calls, so none of them gets a `dangerous` tool.
 */
export type AgentProfile = 'interactive' | 'workflow' | 'assistant' | 'scope'

const READ_TOOLS = (Object.keys(TOOL_ACCESS) as ToolName[]).filter((name) => TOOL_ACCESS[name] === 'read')

export const PROFILE_TOOLS: Record<AgentProfile, readonly ToolName[]> = {
  interactive: Object.keys(TOOL_ACCESS) as ToolName[],
  workflow: [...READ_TOOLS, 'set_node_output', 'add_finding', 'update_finding', 'upsert_target'],
  assistant: [...READ_TOOLS, 'propose_workflow'],
  scope: [...READ_TOOLS, 'upsert_target', 'add_scope_rule', 'set_program_description'],
}

/** Default hard cap so a run_command call can never hang the agent. */
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
/** Grace period after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2_000

/** Maps MCP tool calls to project operations. Transport-agnostic and pure of process concerns. */
export class ProjectToolset {
  constructor(private readonly deps: ToolsetDeps) {}

  private ownerByValue(value: string) {
    const p = this.deps.project.targets
    return (
      p.findByValue('subdomain', value) ??
      p.findByValue('domain', value) ??
      p.findByValue('ip', value) ??
      p.findByValue('url', value)
    )
  }

  /** The boundary as the matcher wants it: the stored rules plus the drafted ones. */
  private draftedRules(draft: ScopeDraftSink): ScopeRule[] {
    const stored = this.deps.project.scopeRules.all()
    const drafted = draft.rules.map((r, i) => ({ id: `draft-${i}`, effect: r.effect, pattern: r.pattern, note: r.note ?? '' }))
    return [...stored, ...drafted]
  }

  /** Propose mode: validate and remember a rule the way the repository would, without writing it. */
  private draftRule(draft: ScopeDraftSink, a: z.infer<typeof scopeRuleArgs>): unknown {
    const pattern = normaliseScopePattern(a.pattern)
    const problem = scopePatternProblem(pattern)
    if (problem !== null) throw new Error(problem)
    const known = (r: { effect: string; pattern: string }): boolean => r.effect === a.effect && r.pattern === pattern
    const note = a.note === undefined ? {} : { note: a.note }
    if (!this.deps.project.scopeRules.all().some(known) && !draft.rules.some(known)) {
      draft.rules.push({ effect: a.effect, pattern, ...note })
    }
    return { draft: true, effect: a.effect, pattern, ...note }
  }

  /** Propose mode: judge a target against the stored and drafted rules, and remember it, without writing it. */
  private draftTarget(draft: ScopeDraftSink, a: z.infer<typeof upsertArgs>): unknown {
    const asset = canonicaliseAsset({ kind: a.kind, value: a.value })
    if (!isCanonicalAsset(asset)) throw new Error(asset.error)
    const verdict = evaluateScope(asset, this.draftedRules(draft))
    if (!draft.targets.some((t) => t.value === asset.value)) draft.targets.push({ kind: asset.kind, value: asset.value })
    return { draft: true, kind: asset.kind, value: asset.value, scopeStatus: verdict.status, scopeReason: verdict.reason }
  }

  async call(name: string, args: Record<string, unknown>, caller: ToolCaller = {}): Promise<unknown> {
    const { project } = this.deps
    const session = this.deps.sessions?.get(caller.sessionId)
    switch (name) {
      case 'list_targets':
        return project.targets.all().map((t) => ({ id: t.id, kind: t.kind, value: t.value, source: t.source }))

      case 'get_target': {
        const { value } = getArgs.parse(args)
        const target = this.ownerByValue(value)
        if (target === undefined) return null
        return { ...target, facts: project.facts.forTarget(target.id), findings: project.findings.forTarget(target.id) }
      }

      case 'upsert_target': {
        const a = upsertArgs.parse(args)
        // A named parent is only a hint: the repository derives parentage from
        // the value itself, and won't nest a target under itself.
        const parent = a.parent === undefined ? undefined : this.ownerByValue(a.parent)
        const parentId = parent === undefined || parent.value.toLowerCase() === a.value.toLowerCase() ? null : parent.id
        // The verdict rides back with the target so an agent learns it has
        // drifted off the engagement at the moment it drifts, not at report time.
        if (session?.scopeDraft !== undefined) return this.draftTarget(session.scopeDraft, a)
        const source = isHeadless(caller) ? HEADLESS_AGENT_TARGET_SOURCE : 'agent'
        return project.targets.upsert({ kind: a.kind, value: a.value, source, parentId })
      }

      case 'add_scope_rule': {
        const a = scopeRuleArgs.parse(args)
        if (session?.scopeDraft !== undefined) return this.draftRule(session.scopeDraft, a)
        const rule = project.scopeRules.add({
          effect: a.effect,
          pattern: a.pattern,
          ...(a.note === undefined ? {} : { note: a.note }),
          source: 'agent',
        })
        // A boundary that only applied to future writes would leave whatever is
        // already in the tree judged against a rule set that no longer exists.
        const rejudged = project.targets.reevaluateScope()
        return { ...rule, rejudged }
      }

      case 'list_scope_rules':
        return project.scopeRules.all()

      case 'set_program_description': {
        const a = programArgs.parse(args)
        // A proposal only drafts rules and targets; it never rewrites the program.
        if (session?.scopeDraft !== undefined) return { ok: true, draft: true }
        const path = writeProgramDescription(project.root, a.markdown)
        return { ok: true, path: basename(path) }
      }

      case 'add_finding': {
        const a = findingArgs.parse(args)
        let targetId: string | null = null
        if (a.target !== undefined) {
          const owner = this.ownerByValue(a.target)
          if (owner === undefined) throw new Error(`no target matches ${a.target}`)
          targetId = owner.id
        }
        // record(), not create(): an agent re-reporting something it already
        // filed refreshes that finding instead of adding a second copy.
        const { finding, created } = project.findings.record({
          targetId,
          severity: a.severity,
          title: a.title,
          ...(a.description === undefined ? {} : { description: a.description }),
          ...(a.details === undefined ? {} : { details: a.details }),
          source: 'agent',
        })
        return { ...finding, created }
      }

      case 'update_finding': {
        const a = updateFindingArgs.parse(args)
        const updated = project.findings.update(a.id, {
          ...(a.title === undefined ? {} : { title: a.title }),
          ...(a.severity === undefined ? {} : { severity: a.severity }),
          ...(a.status === undefined ? {} : { status: a.status }),
          ...(a.description === undefined ? {} : { description: a.description }),
          ...(a.details === undefined ? {} : { details: a.details }),
        })
        if (updated === undefined) throw new Error(`no finding with id ${a.id}`)
        return updated
      }

      case 'list_workflows':
        return project.workflows.list().map((w) => ({ id: w.id, name: w.name }))

      case 'run_workflow': {
        const a = runArgs.parse(args)
        return this.deps.runWorkflow(a.workflowId, a.targetId)
      }

      case 'list_findings': {
        const a = listFindingArgs.parse(args)
        return project.findings.list({
          ...(a.status === undefined ? {} : { status: a.status }),
          ...(a.severity === undefined ? {} : { severity: a.severity }),
        })
      }

      case 'list_executions': {
        const store = this.deps.executionStore
        if (store === undefined) return []
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 10
        return store.listExecutions().slice(0, limit).map((e) => ({
          id: e.id,
          workflowId: e.workflowId,
          targetId: e.targetId,
          status: e.status,
          startedAt: e.startedAt,
          finishedAt: e.finishedAt,
          error: e.error,
        }))
      }

      case 'get_execution': {
        const store = this.deps.executionStore
        if (store === undefined) return null
        // Default to the most recent execution so the agent can "check the last run".
        const id =
          typeof args.executionId === 'string' && args.executionId !== ''
            ? args.executionId
            : store.listExecutions()[0]?.id
        if (id === undefined) return null
        const exec = store.getExecution(id)
        if (exec === undefined) return null
        const CAP = 4000
        const tail = (p: string | null): string => {
          if (p === null) return ''
          try {
            const text = readFileSync(p, 'utf8')
            return text.length > CAP ? text.slice(-CAP) : text
          } catch {
            return ''
          }
        }
        const nodes = store.nodesFor(id).map((n) => ({
          nodeId: n.nodeId,
          status: n.status,
          exitCode: n.exitCode,
          stdout: tail(n.stdoutPath),
          stderr: tail(n.stderrPath),
        }))
        return {
          id: exec.id,
          workflowId: exec.workflowId,
          targetId: exec.targetId,
          status: exec.status,
          error: exec.error,
          startedAt: exec.startedAt,
          finishedAt: exec.finishedAt,
          nodes,
        }
      }

      case 'set_node_output': {
        const a = nodeOutputArgs.parse(args)
        // Only the agent node that launched this session is listening; there is
        // no shared slot another session could write into.
        if (session?.nodeOutput === undefined) {
          throw new Error('set_node_output is only accepted from a running workflow agent node, for its own output')
        }
        session.nodeOutput(a.data)
        return { ok: true }
      }

      case 'list_node_types': {
        const manifests = this.deps.manifests === undefined ? [] : this.deps.manifests()
        return buildNodeTypes(manifests)
      }

      case 'get_workflow_graph':
        return session?.graph ?? { nodes: [], edges: [] }

      case 'propose_workflow': {
        const a = proposeArgs.parse(args)
        // The graph must satisfy the same schema the workflow table stores.
        const parsedGraph = graphSchema.safeParse(a.graph)
        if (!parsedGraph.success) {
          return { ok: false, errors: parsedGraph.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
        }
        const validation = validateGraph(parsedGraph.data)
        if (!validation.ok) return { ok: false, errors: validation.errors }
        if (session?.proposal === undefined) {
          throw new Error('propose_workflow is only accepted from a running workflow assistant turn')
        }
        session.proposal({
          ...(a.name === undefined ? {} : { name: a.name }),
          graph: parsedGraph.data,
          summary: a.summary,
        })
        return { ok: true }
      }

      case 'list_backends': {
        // `local` is always available and is what run_command uses when the
        // backend argument is omitted, so it belongs in the list. Secrets stay
        // out: `env` is reported by key only, and nothing here carries a
        // password (SSH profiles authenticate with an identity file).
        return [
          { id: 'local', name: 'Local', kind: 'local', description: 'this machine (run_command default)' },
          ...project.backends.list().map((b) => ({
            id: b.id,
            name: b.name,
            kind: b.kind,
            ...(b.host !== undefined ? { host: b.host } : {}),
            ...(b.port !== undefined ? { port: b.port } : {}),
            ...(b.user !== undefined ? { user: b.user } : {}),
            ...(b.image !== undefined ? { image: b.image } : {}),
            ...(b.workdir !== undefined ? { workdir: b.workdir } : {}),
            ...(b.env !== undefined && Object.keys(b.env).length > 0 ? { envKeys: Object.keys(b.env).sort() } : {}),
          })),
        ]
      }

      case 'run_command': {
        const a = runCommandArgs.parse(args)
        return this.runCommand(a.command, a.backend)
      }

      default:
        throw new Error(`unknown tool: ${name}`)
    }
  }

  /**
   * Execute a shell command on the chosen backend and return its captured
   * output. `backend` undefined/'local' runs locally; any other id resolves a
   * saved backend profile and runs `sh -lc <command>` there via the profile's
   * launcher (SSH/Docker/local). Unknown ids throw (mapped to an isError result
   * by the rpc layer). A hard timeout (SIGTERM→SIGKILL) guarantees the call
   * never hangs.
   */
  private runCommand(command: string, backend: string | undefined): Promise<RunCommandResult> {
    const { project } = this.deps
    const isLocal = backend === undefined || backend === '' || backend === 'local'
    let profile: BackendProfile | undefined
    if (!isLocal) {
      profile = project.backends.get(backend!)
      if (profile === undefined) throw new Error(`unknown backend: ${backend!}`)
    }
    const label = isLocal ? 'local' : backend!
    const factory = this.deps.launcherFactory ?? launcherForProfile
    const launcher = factory(profile)
    const timeoutMs = this.deps.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS

    return new Promise<RunCommandResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = launcher.launch({ program: 'sh', args: ['-lc', command], cwd: project.root })
      } catch (error) {
        resolve({ stdout: '', stderr: (error as Error).message, exit_code: null, backend: label })
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
      })

      const finish = (exit_code: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(killTimer)
        clearTimeout(graceTimer)
        resolve({ stdout, stderr, exit_code, backend: label })
      }

      // Hard timeout: SIGTERM, then SIGKILL after a grace period.
      const killTimer = setTimeout(() => {
        stderr += `\n[run_command timed out after ${timeoutMs}ms]`
        try {
          child.kill('SIGTERM')
        } catch {
          /* already gone */
        }
      }, timeoutMs)
      const graceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }, timeoutMs + KILL_GRACE_MS)

      child.on('error', (error: Error) => {
        stderr += (stderr === '' ? '' : '\n') + error.message
        finish(null)
      })
      child.on('close', (code: number | null) => finish(code))
    })
  }
}
