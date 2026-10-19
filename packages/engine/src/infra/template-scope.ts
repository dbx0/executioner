export interface NodeOutput {
  output: string
  rows: Array<Record<string, unknown>>
}

export interface LoopContext {
  item: unknown
  index: number
  count: number
}

export interface ScopeInput {
  params: Record<string, unknown>
  target: { value: string; kind: string }
  runDir: string
  nodeOutputs: Record<string, NodeOutput>
  loop?: LoopContext
  /** Run-level variables set by `set_variable` nodes, referenced as {{ vars.x }}. */
  vars?: Record<string, unknown>
  /** Engagement API credentials, referenced as {{ secrets.NAME }}. */
  secrets?: Record<string, string>
  /** The upstream row being processed, referenced as {{ row.field }}. Set by
   *  nodes that walk rows one at a time (save_to_finding). */
  row?: Record<string, unknown>
}

export interface TemplateScope {
  params: Record<string, unknown>
  target: { value: string; kind: string }
  run_dir: string
  nodes: Record<string, Record<string, unknown>>
  vars: Record<string, unknown>
  secrets: Record<string, string>
  loop?: LoopContext
  row?: Record<string, unknown>
}

/**
 * Builds the object that interpolate resolves {{ ... }} against. Each prior
 * node contributes `output` (raw stdout) and the fields of its first parsed row,
 * so `{{ nodes.httpx.output }}` and `{{ nodes.httpx.host }}` both work, matching
 * the documented template vocabulary of the previous engine.
 */
export function buildScope(input: ScopeInput): TemplateScope {
  const nodes: Record<string, Record<string, unknown>> = {}
  for (const [id, out] of Object.entries(input.nodeOutputs)) {
    const first = out.rows[0] ?? {}
    nodes[id] = { ...first, output: out.output }
  }

  const scope: TemplateScope = {
    params: input.params,
    target: input.target,
    run_dir: input.runDir,
    nodes,
    vars: input.vars ?? {},
    secrets: input.secrets ?? {},
  }
  if (input.loop !== undefined) scope.loop = input.loop
  if (input.row !== undefined) scope.row = input.row
  return scope
}
