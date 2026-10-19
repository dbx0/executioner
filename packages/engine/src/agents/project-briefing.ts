import type { Project } from '@exe/project'
import { PROFILE_TOOLS, type AgentProfile, type ToolName } from '../mcp/toolset.js'

/**
 * The orientation an agent gets at launch.
 *
 * A spawned agent starts in the engagement directory with the `project` MCP
 * server attached, but nothing tells it what the engagement *is*: which target
 * it is working, that the tooling lives on a remote backend rather than this
 * laptop, or that an asset inventory and a findings list already exist. It has
 * the tools to discover all of that and no reason to call them, so it behaves
 * like a fresh shell in an unfamiliar folder.
 *
 * This builds a short briefing passed via `claude --append-system-prompt`. It
 * is a snapshot: the MCP tools stay the source of truth, and the briefing says
 * so rather than pretending to be current.
 */

/**
 * One line per project MCP tool, for the tool list in the briefing. Keyed by
 * every tool so a new tool cannot ship without one; the list an agent sees is
 * filtered to its profile's tools, so it is never told about one it lacks.
 */
const TOOL_BRIEFS: Record<ToolName, string> = {
  list_targets: 'the asset inventory',
  get_target: 'one target with its recorded facts and findings',
  upsert_target: 'record an asset you confirmed',
  list_scope_rules: 'the engagement boundary',
  add_scope_rule: 'record a scope include or exclude',
  set_program_description: 'record the program brief',
  list_findings: 'what has been proven so far',
  add_finding:
    'record a proven issue with a severity, a short description and the evidence in `details`; re-reporting one you already filed refreshes it rather than duplicating it. Write `description` and `details` as Markdown, with a fenced code block around every command, request, response and payload',
  update_finding: 'change a finding, such as setting its status once triaged',
  list_backends: 'the execution backends',
  run_command: 'run a shell command on a backend',
  list_workflows: 'the saved workflows',
  run_workflow: 'run a saved workflow against a target',
  list_executions: 'past workflow runs',
  get_execution: 'what one past run did, node by node',
  list_node_types: 'the node types a workflow can use',
  get_workflow_graph: 'the workflow graph this run is editing',
  propose_workflow: 'hand the operator a workflow graph to review and apply',
  set_node_output: 'return this agent node’s structured result to the workflow',
}

/** Targets listed inline before the briefing switches to "call list_targets". */
const MAX_TARGETS = 25

/** Order findings worst-first regardless of how they were recorded. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

function severityBreakdown(severities: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const s of severities) {
    const key = s.trim().toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const known = SEVERITY_ORDER.filter((s) => counts.has(s)).map((s) => `${counts.get(s)!} ${s}`)
  const other = [...counts.keys()]
    .filter((s) => !SEVERITY_ORDER.includes(s))
    .sort()
    .map((s) => `${counts.get(s)!} ${s}`)
  return [...known, ...other].join(', ')
}

/**
 * One line per backend. `env` values are deliberately omitted — a profile's
 * environment can carry credentials, and the agent only needs to know the
 * variable exists.
 */
function backendLines(project: Project): string[] {
  const lines = ['- `local` — this machine (the default when `backend` is omitted)']
  for (const b of project.backends.list()) {
    const where =
      b.kind === 'ssh'
        ? `ssh ${b.user ?? '?'}@${b.host ?? '?'}${b.port !== undefined ? `:${b.port}` : ''}`
        : b.kind === 'docker'
          ? `docker ${b.image ?? '?'}`
          : 'local'
    const workdir = b.workdir !== undefined && b.workdir !== '' ? `, workdir ${b.workdir}` : ''
    const env = b.env !== undefined && Object.keys(b.env).length > 0 ? `, env ${Object.keys(b.env).sort().join('/')}` : ''
    lines.push(`- \`${b.id}\` — ${b.name}: ${where}${workdir}${env}`)
  }
  return lines
}

/**
 * Build the launch briefing for an engagement. Never throws: a repository that
 * cannot be read is simply left out rather than blocking the spawn.
 *
 * `mcp` (default true) tailors the briefing to whether this agent actually has
 * the project MCP toolset. With it on, the briefing tells the agent to read and
 * write engagement state through the MCP tools. With it off — an agent that gets
 * the context but not the toolset — those instructions are dropped: the agent is
 * oriented with the same snapshot, but never told to call tools it does not have.
 *
 * `profile` (default `interactive`) names which tools the agent has: every
 * tool the briefing mentions is taken from that profile's PROFILE_TOOLS, so a
 * headless agent is never told to call `run_command` or anything else it would
 * be refused.
 */
export function buildProjectBriefing(
  project: Project,
  memoryDir?: string,
  opts?: { mcp?: boolean; profile?: AgentProfile },
): string {
  const mcp = opts?.mcp ?? true
  const profile = opts?.profile ?? 'interactive'
  const tools: readonly ToolName[] = mcp ? PROFILE_TOOLS[profile] : []
  const has = (tool: ToolName): boolean => tools.includes(tool)
  const canWriteFiles = profile === 'interactive'
  const sections: string[] = [
    'You are running inside Executioner, a workspace for an authorised offensive-security engagement. This briefing orients you; act on the operator’s request, not on the briefing alone.',
    `Engagement: ${project.config.name}\nEngagement directory: ${project.root} (your working directory)`,
  ]

  // The backend section only makes sense with the MCP `run_command` tool; a
  // non-MCP agent can only run things itself in the working directory, and a
  // headless one cannot run commands at all.
  if (has('run_command')) {
    try {
      const backends = backendLines(project)
      sections.push(
        [
          'Execution backends — pass the id as `backend` to the `run_command` MCP tool:',
          ...backends,
          backends.length > 1
            ? 'Scanning and exploitation tooling is generally installed on the configured backends rather than on this machine, so prefer a backend over `local` for tool runs and check with `run_command` before assuming a binary is missing.'
            : 'No remote backend is configured, so commands run on this machine.',
        ].join('\n'),
      )
    } catch {
      /* a backend read failure must not block the launch */
    }
  }

  try {
    const targets = project.targets.all()
    if (targets.length === 0) {
      sections.push(
        has('upsert_target')
          ? 'Targets: none recorded yet. Record each asset you confirm with `upsert_target` so the rest of the workspace sees it.'
          : 'Targets: none recorded yet.',
      )
    } else {
      const shown = targets.slice(0, MAX_TARGETS).map((t) => `- ${t.kind} ${t.value}`)
      const more =
        targets.length > MAX_TARGETS
          ? has('list_targets')
            ? `\n…and ${targets.length - MAX_TARGETS} more — call \`list_targets\` for the full inventory.`
            : `\n…and ${targets.length - MAX_TARGETS} more.`
          : ''
      sections.push(`Targets recorded (${targets.length}):\n${shown.join('\n')}${more}`)
    }
  } catch {
    /* target read failure: fall through to the tool list below */
  }

  try {
    const findings = project.findings.list()
    sections.push(
      findings.length === 0
        ? has('add_finding')
          ? 'Findings: none recorded yet. Record what you prove with `add_finding`.'
          : 'Findings: none recorded yet.'
        : has('list_findings')
          ? `Findings recorded: ${findings.length} (${severityBreakdown(findings.map((f) => f.severity))}). Call \`list_findings\` before reporting so you do not duplicate one.`
          : `Findings recorded: ${findings.length} (${severityBreakdown(findings.map((f) => f.severity))}).`,
    )
  } catch {
    /* finding read failure: fall through */
  }

  if (memoryDir !== undefined) {
    sections.push(
      [
        `Engagement memory: ${memoryDir}`,
        'Its `MEMORY.md` is the index — one line per memory, with the memory itself in its own file alongside. It carries across agents and sessions in this engagement, so it is how the next agent starts from what you learned instead of from nothing. An empty index is normal on a new engagement, not a missing file.',
        ...(canWriteFiles
          ? [
              'Worth recording: which backend actually has which tooling installed, scope decisions and what the programme excluded, credentials already verified (and how), target quirks such as a WAF that blocks a technique, and dead ends so they are not re-run.',
              has('upsert_target') && has('add_finding')
                ? 'Not worth recording: anything the project already holds. Confirmed assets belong in `upsert_target` and proven issues in `add_finding` — memory is for what those cannot express.'
                : 'Not worth recording: anything the project already holds — memory is for what the target and finding records cannot express.',
            ]
          : ['This run cannot edit files, so read the memory for what earlier agents learned but do not try to add to it.']),
      ].join('\n'),
    )
  }

  if (tools.length > 0) {
    const lines = tools.map((tool) => `- \`${tool}\`: ${TOOL_BRIEFS[tool]}`)
    const records = (['upsert_target', 'add_finding'] as const).filter(has)
    sections.push(
      [
        'The `project` MCP server is this engagement’s live state and the source of truth — the numbers above are a snapshot taken when you launched. These are the tools you have:',
        ...lines,
        ...(has('run_command')
          ? []
          : ['You cannot run commands or workflows in this session; any other project tool is refused.']),
        ...(records.length > 0
          ? [
              `Record ${records.map((t) => (t === 'upsert_target' ? 'confirmed assets' : 'findings')).join(' and ')} through those tools rather than only in chat, or the work is invisible to the rest of the workspace and to the next agent.`,
            ]
          : []),
      ].join('\n'),
    )
  } else {
    sections.push(
      'The numbers above are a snapshot from when you launched. You do not have this engagement’s MCP toolset, so work from your own tools in the engagement directory and report what you find to the operator.',
    )
  }

  return sections.join('\n\n')
}
