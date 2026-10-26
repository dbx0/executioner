import type { ToolManifest, ParamSpec } from '@exe/protocol'

/** A node param described for the assistant, flattened from the engine specs. */
export interface AssistantParam {
  name: string
  /** 'string' | 'number' | 'boolean' | 'enum'. */
  type: string
  required?: boolean
  default?: string | number | boolean
  /** Allowed values when the param is an enum. */
  oneOf?: string[]
  description?: string
}

/** One usable node type advertised to the workflow assistant. */
export interface AssistantNodeType {
  type: string
  label: string
  /** 'tool' for engine manifests; the built-in node kind otherwise. */
  kind: string
  category: string
  description?: string
  params: AssistantParam[]
  /** Fields this node exposes on its output row, referenceable downstream as
   *  `{{ nodes.<thisNodeId>.<field> }}`. Every node also exposes `output` (its
   *  raw text). Empty when the node produces no structured fields. */
  outputs?: string[]
}

/** Build an AssistantParam, omitting optional keys so exactOptionalPropertyTypes holds. */
function param(p: {
  name: string
  type: string
  required?: boolean
  default?: string | number | boolean
  oneOf?: string[]
  description?: string
}): AssistantParam {
  return {
    name: p.name,
    type: p.type,
    ...(p.required === undefined ? {} : { required: p.required }),
    ...(p.default === undefined ? {} : { default: p.default }),
    ...(p.oneOf === undefined ? {} : { oneOf: p.oneOf }),
    ...(p.description === undefined ? {} : { description: p.description }),
  }
}

/**
 * The built-in graph node types (triggers, control flow, agent, logic, data,
 * integration, and the bundled recon nodes that are not manifests). Mirrors the
 * desktop node catalog's CONTROL_ENTRIES so the assistant proposes the same node
 * types the canvas can render. The engine is the source of truth for the prompt.
 */
export const BUILTIN_NODE_TYPES: AssistantNodeType[] = [
  {
    type: 'manual',
    label: 'Manual Trigger',
    kind: 'manual',
    category: 'trigger',
    description: 'Entry point for a workflow started by hand. No parameters.',
    params: [],
  },
  {
    type: 'schedule',
    label: 'Schedule Trigger',
    kind: 'schedule',
    category: 'trigger',
    description: 'Entry point run on a recurring interval. Arm it per engagement in Schedules, which reads this interval.',
    params: [
      param({ name: 'interval_seconds', type: 'number', default: 3600, description: 'How often to run, in seconds.' }),
      param({ name: 'cron', type: 'string', description: 'Optional cron expression (informational).' }),
    ],
  },
  {
    type: 'on_create',
    label: 'On Create Trigger',
    kind: 'on_create',
    category: 'trigger',
    description: 'Entry point fired when a matching target is created. Arm it per engagement in Schedules, which reads this kind.',
    params: [
      param({
        name: 'target_kind',
        type: 'enum',
        oneOf: ['domain', 'subdomain', 'ip', 'cidr', 'url'],
        default: 'domain',
        description: 'Target kind whose creation fires this workflow.',
      }),
    ],
  },
  {
    type: 'if',
    label: 'If',
    kind: 'if',
    category: 'control',
    description: 'Branch on an expression evaluated against the upstream node output. Edges use sourceHandle "true"/"false".',
    params: [
      param({
        name: 'expression',
        type: 'string',
        description:
          'Condition over the upstream output row, read as `data`, e.g. data.status === "open" && data.count > 0. Supports literals, data.field and data.list[0] paths, comparisons, && || ! ??, + - * / %, ?: and the helpers String, Number, Boolean, includes, startsWith, endsWith, toLowerCase, toUpperCase, trim and new RegExp("...").test(...). {{ }} templates are resolved first.',
      }),
    ],
  },
  {
    type: 'loop',
    label: 'Loop',
    kind: 'loop',
    category: 'control',
    description: 'Iterate the body over a newline/JSON list resolved from a template.',
    params: [param({ name: 'source', type: 'string' })],
  },
  {
    type: 'stop',
    label: 'Stop',
    kind: 'stop',
    category: 'control',
    description: 'Halt the workflow.',
    params: [],
  },
  {
    type: 'agent',
    label: 'Agent',
    kind: 'agent',
    category: 'agent',
    description:
      'Run an AI agent against the project context; returns structured output. It can read the project and record targets and findings, but cannot run commands or workflows.',
    params: [
      param({
        name: 'agent',
        type: 'enum',
        oneOf: ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'hermes'],
        default: 'claude',
        description: 'Which agent CLI runs this node, headless.',
      }),
      param({ name: 'prompt', type: 'string' }),
      param({
        name: 'allow_unrestricted_cli',
        type: 'boolean',
        default: false,
        description: 'Set true to run cursor or hermes, whose own shell and file tools cannot be locked down when they run headless. Claude, codex, gemini and opencode never need it.',
      }),
    ],
  },
  {
    type: 'set_variable',
    label: 'Set Variable',
    kind: 'set_variable',
    category: 'logic',
    description: 'Assign run variables (referenced downstream as {{ vars.name }}).',
    params: [param({ name: 'variables', type: 'string', description: 'JSON map of name → value; values may use templates.' })],
  },
  {
    type: 'merge',
    label: 'Merge',
    kind: 'merge',
    category: 'logic',
    description: 'Combine the outputs of all upstream nodes into one.',
    params: [],
  },
  {
    type: 'save_to_target',
    label: 'Save to Target',
    kind: 'save_to_target',
    category: 'data',
    description: 'Persist upstream rows to the workflow target as targets or facts.',
    params: [
      param({ name: 'data_type', type: 'enum', oneOf: ['subdomain', 'open_port', 'technology', 'raw_output'], default: 'raw_output' }),
      param({ name: 'field', type: 'string', default: 'value', description: 'Row field holding the value to save.' }),
    ],
    outputs: ['saved', 'data_type'],
  },
  {
    type: 'save_to_finding',
    label: 'Save to Finding',
    kind: 'save_to_finding',
    category: 'data',
    description:
      'Record upstream rows as engagement findings. Every field is a template evaluated per row, with {{ row.<field> }} bound to the row in hand.',
    params: [
      param({
        name: 'title',
        type: 'string',
        description: 'e.g. Secret in {{ row.file }}. Falls back to a name-like field on the row.',
      }),
      param({ name: 'severity', type: 'enum', oneOf: ['critical', 'high', 'medium', 'low', 'info'], default: 'medium' }),
      param({ name: 'description', type: 'string', description: 'The short what-and-why.' }),
      param({ name: 'details', type: 'string', description: 'The evidence. Defaults to the whole row.' }),
      param({ name: 'target', type: 'string', description: 'Asset value this is found on. Defaults to the run target.' }),
    ],
    outputs: ['id', 'title', 'severity', 'status', 'created'],
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    kind: 'http_request',
    category: 'integration',
    description:
      'Perform an HTTP request; the response becomes this node output. Internal addresses (localhost, private networks, cloud metadata) are refused unless allow_internal is true.',
    params: [
      param({ name: 'method', type: 'enum', oneOf: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' }),
      param({ name: 'url', type: 'string', required: true, description: 'http or https only. Up to 5 redirects are followed.' }),
      param({
        name: 'headers',
        type: 'string',
        description: 'JSON object of request headers. Values may use {{ }} placeholders.',
      }),
      param({
        name: 'body',
        type: 'string',
        description: 'Placeholders are JSON-escaped in a json body and URL-encoded in a form body.',
      }),
      param({ name: 'body_type', type: 'enum', oneOf: ['json', 'form', 'raw'], default: 'json' }),
      param({ name: 'timeout', type: 'number', default: 30000, description: 'Request timeout in milliseconds.' }),
      param({
        name: 'allow_internal',
        type: 'boolean',
        default: false,
        description:
          'Set true to test an internal target: loopback, private and link-local networks, including cloud metadata. The engine API port stays blocked.',
      }),
    ],
    outputs: ['status', 'body'],
  },
  {
    type: 'notify',
    label: 'Notify',
    kind: 'notify',
    category: 'integration',
    description:
      'Post a message to a Discord or Slack webhook. A webhook on an internal address (localhost, private networks, cloud metadata) is refused unless allow_internal is true.',
    params: [
      param({ name: 'platform', type: 'enum', oneOf: ['discord', 'slack'], default: 'discord' }),
      param({
        name: 'webhook_url',
        type: 'string',
        required: true,
        description: 'http or https only. Up to 5 redirects are followed.',
      }),
      param({ name: 'message', type: 'string', required: true }),
      param({ name: 'timeout', type: 'number', default: 15000, description: 'Request timeout in milliseconds.' }),
      param({
        name: 'allow_internal',
        type: 'boolean',
        default: false,
        description:
          'Set true to post to a webhook on an internal address, such as a local Slack relay: loopback, private and link-local networks. The engine API port stays blocked.',
      }),
    ],
  },
  {
    type: 'geoip',
    label: 'GeoIP',
    kind: 'geoip',
    category: 'recon',
    description: 'Resolve IP geolocation via ip-api.com (no API key). Records a geolocation fact.',
    params: [param({ name: 'target', type: 'string', description: 'IP/host to geolocate. Defaults to the run target.' })],
    outputs: ['country', 'city', 'lat', 'lon', 'isp', 'org', 'as'],
  },
  {
    type: 'shodan',
    label: 'Shodan',
    kind: 'shodan',
    category: 'recon',
    description: 'Shodan host lookup. Needs the SHODAN_API_KEY secret.',
    params: [
      param({ name: 'target', type: 'string', description: 'IP to query. Defaults to the run target.' }),
      param({ name: 'api_key', type: 'string', default: '{{ secrets.SHODAN_API_KEY }}' }),
    ],
  },
  {
    type: 'censys',
    label: 'Censys',
    kind: 'censys',
    category: 'recon',
    description: 'Censys host view. Needs the CENSYS_API_ID/CENSYS_API_SECRET secrets.',
    params: [
      param({ name: 'target', type: 'string', description: 'IP to query. Defaults to the run target.' }),
      param({ name: 'api_id', type: 'string', default: '{{ secrets.CENSYS_API_ID }}' }),
      param({ name: 'api_secret', type: 'string', default: '{{ secrets.CENSYS_API_SECRET }}' }),
    ],
  },
  {
    type: 'screenshot',
    label: 'Screenshot',
    kind: 'screenshot',
    category: 'web',
    description: 'Capture a screenshot of a URL using the system headless Chrome/Chromium.',
    params: [
      param({ name: 'target', type: 'string', description: 'URL/host to screenshot. Defaults to the run target.' }),
      param({ name: 'full_page', type: 'boolean', default: false }),
      param({ name: 'timeout', type: 'number', default: 30000 }),
    ],
    outputs: ['path'],
  },
  {
    type: 'python_script',
    label: 'Python Script',
    kind: 'python_script',
    category: 'logic',
    description:
      'Run an arbitrary Python script (python3). Print a JSON dict/array for downstream rows. Put {{ }} placeholders inside a string literal: values are inserted escaped, as text.',
    params: [
      param({ name: 'script', type: 'string', default: 'import json\nprint(json.dumps({"status": "ok"}))' }),
      param({ name: 'timeout', type: 'number', default: 60000 }),
    ],
  },
]

/** Map a single engine manifest param spec to the assistant param shape. */
function manifestParam(name: string, spec: ParamSpec): AssistantParam {
  const base = {
    name,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.required === undefined ? {} : { required: spec.required }),
  }
  switch (spec.type) {
    case 'enum':
      return param({ ...base, type: 'enum', oneOf: spec.values, ...(spec.default === undefined ? {} : { default: spec.default }) })
    case 'number':
      return param({ ...base, type: 'number', ...(spec.default === undefined ? {} : { default: spec.default }) })
    case 'bool':
      return param({ ...base, type: 'boolean', ...(spec.default === undefined ? {} : { default: spec.default }) })
    default:
      return param({ ...base, type: 'string', ...(spec.default === undefined ? {} : { default: spec.default }) })
  }
}

const WHOIS_FIELDS = [
  'registrar',
  'registrant',
  'creation_date',
  'updated_date',
  'expiry_date',
  'name_servers',
  'domain_status',
  'dnssec',
  'emails',
]

/**
 * The record fields a tool node exposes downstream (as `{{ nodes.<id>.field }}`),
 * derived from its manifest's emit spec: regex named groups, whois's fixed field
 * set, and any `record.<field>` referenced in the fact/target templates.
 */
export function manifestOutputs(m: ToolManifest): string[] {
  const fields = new Set<string>()
  const emit = m.emit
  if (emit.parser === 'regex' && emit.pattern !== undefined) {
    for (const g of emit.pattern.matchAll(/\(\?<([A-Za-z_]\w*)>/g)) if (g[1] !== undefined) fields.add(g[1])
  }
  if (emit.parser === 'whois') for (const f of WHOIS_FIELDS) fields.add(f)
  const scan = (t: string | undefined): void => {
    if (t === undefined) return
    for (const g of t.matchAll(/record\.([A-Za-z_]\w*)/g)) if (g[1] !== undefined) fields.add(g[1])
  }
  for (const rule of emit.facts ?? []) for (const v of Object.values(rule.data)) scan(typeof v === 'string' ? v : undefined)
  for (const rule of emit.targets ?? []) scan(rule.value)
  return [...fields]
}

/** Convert an engine tool manifest to the assistant node-type shape. */
export function manifestToNodeType(m: ToolManifest): AssistantNodeType {
  const outputs = manifestOutputs(m)
  return {
    type: m.id,
    label: m.name,
    kind: 'tool',
    category: m.category,
    description: m.description,
    params: Object.entries(m.params).map(([name, spec]) => manifestParam(name, spec)),
    ...(outputs.length > 0 ? { outputs } : {}),
  }
}

/** The full node-type catalog: built-in graph nodes plus the engine tool manifests. */
export function buildNodeTypes(manifests: ToolManifest[]): AssistantNodeType[] {
  return [...BUILTIN_NODE_TYPES, ...manifests.map(manifestToNodeType)]
}
