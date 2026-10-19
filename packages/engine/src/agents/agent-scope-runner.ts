import type { Project } from '@exe/project'
import type { TargetKind } from '@exe/protocol'
import type { EventBus } from '../transport/events.js'

/** A target the run created, as reported back to the confirmation page. */
export interface ScopeEntry {
  kind: TargetKind
  value: string
}

/**
 * The instruction handed to the default agent for the "Start with AI" flow. The
 * agent is the ONLY thing that reads the scope — it turns the free-form program
 * text into targets by calling the MCP toolset itself. No regex parsing of the
 * prose happens anywhere; the rules below are the agent's contract.
 */
export function buildScopePrompt(scope: string, description = ''): string {
  const brief = description.trim()
  const passes = brief === '' ? 'two passes' : 'three passes'
  return [
    'You are setting up a bug-bounty engagement. Below is the raw program scope.',
    `Record it in ${passes}, using the MCP tools.`,
    '',
    ...(brief === ''
      ? []
      : [
          'PASS 0 — the brief. The operator’s own notes on this program are at the',
          'bottom, under NOTES. Tidy them and record the result with',
          '`mcp__project__set_program_description`:',
          '- Markdown. A sentence or two on what the program is, then bullets for',
          '  the rules of engagement, the focus areas, and anything that limits',
          '  testing. Keep it short enough to read at a glance.',
          '- Reformat only. Every fact, host, URL, limit and payout in the notes',
          '  must survive word for word. Add nothing that is not there: no invented',
          '  sections, no assumed rules, no filler.',
          '- Notes that are already clean prose go in unchanged.',
          '- If the notes say nothing about the program, skip this pass.',
          '',
        ]),
    'PASS 1 — the boundary. Scope rules say WHERE testing may happen. Every',
    'pattern must name an asset a tool could aim at:',
    '- a host: example.com',
    '- a wildcard: *.example.com (covers the apex and everything under it)',
    '- a network: 10.0.0.0/8',
    '- a url or path glob: */admin/*',
    'Call `mcp__project__add_scope_rule` with effect "include" for an in-scope',
    'entry and "exclude" for an asset the program forbids. Put the reason in',
    '`note`. Record every exclusion the program names — an excluded domain, a',
    'forbidden path, a third party — because an exclusion always beats an',
    'include, and a boundary with only includes cannot rule anything out.',
    '',
    'A program\'s out-of-scope section usually mixes assets with POLICY: kinds of',
    'bug that earn no bounty (denial of service, self-XSS, missing headers,',
    'duplicates, version disclosure, unpatched public CVEs). Policy is NOT a',
    'scope rule. It names no asset, so a rule for it can never match anything and',
    'the call will be rejected. Do not invent a pattern to carry it — no',
    '`class:denial-of-service`, no `device:...`, no `asset:...`. Leave those out',
    'of the rules and mention them in your closing summary instead.',
    '',
    'Some programs list assets that are not network assets at all: an iOS App',
    'Store id, an Android package name, a vehicle ECU, a piece of hardware. These',
    'are not scope rules and not targets. Do not file them. Name them in your',
    'summary so the operator knows they are in scope and must be tested by hand.',
    '',
    'PASS 2 — the assets. Register each concrete in-scope host with',
    '`mcp__project__upsert_target`:',
    '- kind is "domain", "subdomain", "ip", "cidr" or "url". It is a hint: the',
    '  value decides, so do not agonise over it.',
    '- Never register a wildcard. `*.example.com` is a rule, and PASS 1 has it.',
    '  Register the apex `example.com` as the asset instead.',
    '- Register only hosts the program actually lists. Do not invent subdomains,',
    '  and do not turn an example email address or a policy sentence into a host.',
    '- The result carries scopeStatus. If it comes back "unknown", your rules do',
    '  not cover the host you just added: fix the rules or drop the host.',
    '',
    'Finish with a one-line summary of the rules and targets you recorded, then',
    'list anything the program scopes that you could not record — policy',
    'exclusions, mobile apps, hardware — so the operator can see it.',
    '',
    'SCOPE:',
    scope,
    ...(brief === '' ? [] : ['', 'NOTES:', brief]),
  ].join('\n')
}

export interface ScopeRunInput {
  /** The free-form scope paste (HackerOne/Bugcrowd/etc., or a plain target list). */
  scope: string
  /** The operator's own notes on the program, for the agent to tidy into
   *  HUNT.md. Absent or blank leaves the scaffolded text alone. */
  description?: string
  /** The id this run streams its progress bubbles under (executionId on the bus). */
  runId: string
}

export interface ScopeRunSummary {
  runId: string
  /** The targets newly created by this run (excludes ones that already existed). */
  added: ScopeEntry[]
  /** Total in-scope targets parsed (added + already present). */
  total: number
}

export interface AgentScopeRunnerDeps {
  bus: EventBus
  project: Project
  /** The engagement root the agent runs in. */
  cwd: string
  /**
   * The LLM step: run the user's default agent headless with the MCP toolset so
   * it reads the scope and calls `upsert_target` itself. This is the ONLY way the
   * "Start with AI" flow adds targets — there is no regex fallback. Injected by
   * the route when a capable agent is available; when it is absent the run adds
   * nothing and says so (the user picks a working agent, or uses Manual entry).
   */
  runAgent?: (input: { scope: string; description: string; runId: string }) => Promise<void>
}

/**
 * Runs the user's default agent to turn a free-form scope into engagement targets
 * and streams progress bubbles. The agent is the sole parser — it decides which
 * hosts are in scope and registers them via MCP `upsert_target`. This class only
 * launches the agent, then reports which targets appeared. Nothing here parses
 * the scope text. Bubbles are emitted as bus `agent` events keyed by `runId`.
 */
export class AgentScopeRunner {
  constructor(private readonly deps: AgentScopeRunnerDeps) {}

  private emit(runId: string, nodeId: string, payload: Record<string, unknown>): void {
    this.deps.bus.publish({ type: 'agent', executionId: runId, nodeId, data: JSON.stringify(payload) })
  }

  async run(input: ScopeRunInput): Promise<ScopeRunSummary> {
    const { project, runAgent } = this.deps
    const { scope, runId } = input
    const description = input.description ?? ''
    const key = (t: { kind: string; value: string }): string => `${t.kind}:${t.value}`

    this.emit(runId, 'scope-progress', {
      message: description.trim() === '' ? 'Reading the scope…' : 'Reading the brief and the scope…',
    })

    if (runAgent === undefined) {
      this.emit(runId, 'scope-progress', {
        message: 'AI setup needs a working agent. Pick one in Settings, or add targets manually.',
      })
      this.emit(runId, 'scope-done', { total: 0, added: 0, targets: [] })
      return { runId, added: [], total: 0 }
    }

    // The agent is the only parser. Snapshot what exists so we can report exactly
    // what IT added, and let its own MCP tool calls do all the work.
    const before = new Set(project.targets.all().map(key))
    try {
      await runAgent({ scope, description, runId })
    } catch (error) {
      this.emit(runId, 'scope-progress', { message: `The agent couldn’t finish: ${(error as Error).message}` })
    }

    // Apex rows the tree invented to hang a subdomain on are scaffolding, not
    // findings of the parse: report what the agent decided, not what the shape
    // of the tree required.
    const added: ScopeEntry[] = project.targets
      .all()
      .filter((t) => !before.has(key(t)) && t.source !== 'derived')
      .map((t) => ({ kind: t.kind, value: t.value }))

    for (const e of added) {
      this.emit(runId, 'scope-progress', { message: `Added ${e.kind} ${e.value}`, target: e.value })
    }
    this.emit(runId, 'scope-done', { total: added.length, added: added.length, targets: added })
    return { runId, added, total: added.length }
  }
}
