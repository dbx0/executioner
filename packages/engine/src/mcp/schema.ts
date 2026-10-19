export interface ToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const str = { type: 'string' }

/** JSON-schema tool definitions returned by tools/list. */
export const TOOL_SCHEMAS: ToolSchema[] = [
  { name: 'list_targets', description: 'List all targets in the project.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_target', description: 'Get one target with its facts and findings.', inputSchema: { type: 'object', properties: { value: str }, required: ['value'] } },
  {
    name: 'upsert_target',
    description:
      'Add or update a target (domain, subdomain, ip, cidr, url). kind is a hint only — the value decides, so an apex handed in as a subdomain is filed as a domain, and a host is parented under its registrable domain automatically. Never pass a wildcard such as *.example.com: that is a scope rule, and this call rejects it. The result carries scopeStatus (in/out/unknown) and scopeReason: when it comes back "unknown" the asset is outside everything the program listed, so stop and check before you test it.',
    inputSchema: { type: 'object', properties: { kind: str, value: str, parent: str }, required: ['kind', 'value'] },
  },
  {
    name: 'add_scope_rule',
    description:
      "Record one line of the engagement's boundary — WHERE testing may happen. effect is 'include' or 'exclude'. pattern must name an asset a tool could aim at: a host (example.com), a wildcard (*.example.com, which covers the apex too), a network (10.0.0.0/8), or a glob with a path (*/admin/*). note is why, and is shown to whoever reads the verdict later. An exclude always beats an include, so record every 'do not test' asset the program names. Adding a rule re-judges every target already in the tree. This is NOT for policy: a kind of bug that earns no bounty (denial of service, duplicates, version disclosure, unpatched CVEs) names no asset, and a pattern invented to carry it — class:..., device:..., asset:... — is rejected. Nor is it for non-network assets such as an App Store id or an Android package; report those in your summary instead.",
    inputSchema: {
      type: 'object',
      properties: { effect: str, pattern: str, note: str },
      required: ['effect', 'pattern'],
    },
  },
  {
    name: 'set_program_description',
    description:
      "Record the engagement's program brief: what this program is and the rules that govern testing it. Replaces the '## Program' section of HUNT.md and leaves the rest of the file alone. markdown is Markdown — a short paragraph, then bullets for rules of engagement, focus areas and limits. This is for REFORMATTING what the operator wrote: keep every fact, URL, limit and payout word for word, and never invent one. Scope patterns belong in add_scope_rule, not here.",
    inputSchema: { type: 'object', properties: { markdown: str }, required: ['markdown'] },
  },
  {
    name: 'list_scope_rules',
    description: "List the engagement's scope rules. Check here before adding an asset you are unsure about.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_finding',
    description:
      'Record a finding in the engagement. severity is one of critical/high/medium/low/info. description is the short what-and-why; details holds the evidence (request, payload, matched secret). target is the asset value it was found on, and may be omitted when none applies. Reporting the same title against the same target again refreshes that finding rather than duplicating it. Write description and details as Markdown — headings, lists, tables, **bold**, and a fenced code block around every command, request, response or payload — because both are stored and exported as Markdown, never as plain text.',
    inputSchema: {
      type: 'object',
      properties: { target: str, severity: str, title: str, description: str, details: str },
      required: ['severity', 'title'],
    },
  },
  {
    name: 'update_finding',
    description:
      'Update a finding by id — re-severity it, correct its text, or set status to open/confirmed/false_positive/discarded/fixed after triage. Use discarded for a real finding you are setting aside (out of scope, won\'t-fix, duplicate) and false_positive for one that is not a real issue. Always set status through this field — never encode triage state in the title (no "[discarded]"-style tags). description and details are Markdown; keep them so when you rewrite them.',
    inputSchema: {
      type: 'object',
      properties: { id: str, title: str, severity: str, status: str, description: str, details: str },
      required: ['id'],
    },
  },
  {
    name: 'list_findings',
    description: 'List the engagement findings, worst severity first. Optionally filter by status or severity.',
    inputSchema: { type: 'object', properties: { status: str, severity: str } },
  },
  { name: 'list_workflows', description: 'List saved workflows.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_executions',
    description: 'List recent workflow executions (newest first) with their status. Use to find the last run.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_execution',
    description:
      'Inspect one execution to diagnose what happened. Omit executionId for the most recent run. Returns each node with its status, exit code, and stdout/stderr tail.',
    inputSchema: { type: 'object', properties: { executionId: str } },
  },
  { name: 'run_workflow', description: 'Run a saved workflow against a target.', inputSchema: { type: 'object', properties: { workflowId: str, targetId: str }, required: ['workflowId', 'targetId'] } },
  {
    name: 'list_backends',
    description:
      'List the execution backends this engagement can run commands on: the local machine plus every saved SSH/Docker profile. Call this before run_command when you need tooling that is installed on a remote host rather than locally. Credentials are never returned.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command and get back its stdout, stderr and exit code. Omit backend (or pass "local") to run on this machine; pass a saved backend profile id to run the command on that backend (SSH/Docker/local). Has a hard timeout so it never hangs.',
    inputSchema: { type: 'object', properties: { command: str, backend: str }, required: ['command'] },
  },
  { name: 'set_node_output', description: 'Return structured data as this agent node output for downstream steps.', inputSchema: { type: 'object', properties: { data: { type: 'object' } }, required: ['data'] } },
  {
    name: 'list_node_types',
    description:
      'List every usable workflow node type with its params/settings (built-in graph nodes plus engine tool nodes). Call this before proposing a workflow so you use real node types and param names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_workflow_graph',
    description:
      'Return the current canvas graph ({nodes, edges}) for the workflow being edited, so you can modify it rather than rebuild from scratch.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_workflow',
    description:
      'Propose the FULL new workflow graph plus a one-line summary. The graph is validated; on failure the errors are returned so you can fix and retry. This never writes anything — the user reviews and applies the proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        name: str,
        graph: {
          type: 'object',
          description: 'Full graph: { nodes: [{ id, type, data }], edges: [{ id, source, target, sourceHandle? }] }.',
          properties: {
            nodes: { type: 'array', items: { type: 'object' } },
            edges: { type: 'array', items: { type: 'object' } },
          },
          required: ['nodes', 'edges'],
        },
        summary: str,
      },
      required: ['graph', 'summary'],
    },
  },
]
