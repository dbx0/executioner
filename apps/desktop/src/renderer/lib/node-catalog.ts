import type { NodeListing } from '../api/nodes.js'
import { toParamSpecs, type ParamSpec } from './param-specs.js'

export type NodeKind =
  | 'tool'
  | 'agent'
  | 'manual'
  | 'schedule'
  | 'on_create'
  | 'if'
  | 'loop'
  | 'stop'
  | 'set_variable'
  | 'merge'
  | 'save_to_target'
  | 'save_to_finding'
  | 'http_request'
  | 'notify'
  | 'geoip'
  | 'shodan'
  | 'censys'
  | 'screenshot'
  | 'python_script'

export interface CatalogEntry {
  /** Engine node type id placed on the graph node. */
  type: string
  label: string
  kind: NodeKind
  category: string
  description?: string
  accepts?: string[]
  params: ParamSpec[]
  /** Fields this node exposes downstream (as {{ nodes.<id>.<field> }}). */
  outputs?: string[]
}

/** Category → accent color (matches the original Executioner palette semantics). */
export const CATEGORY_COLOR: Record<string, string> = {
  trigger: '#22c55e',
  recon: '#3b82f6',
  scan: '#f97316',
  scanning: '#f97316',
  web: '#06b6d4',
  network: '#84cc16',
  logic: '#ec4899',
  control: '#ec4899',
  data: '#eab308',
  integration: '#8b5cf6',
  agent: 'var(--ai)',
  test: '#a1a1a1',
}

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? '#a1a1a1'
}

/** Control-flow + agent nodes are not engine manifests; they are built-in graph node types. */
export const CONTROL_ENTRIES: CatalogEntry[] = [
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
      { name: 'interval_seconds', type: 'number', default: 3600, description: 'How often to run, in seconds.' },
      { name: 'cron', type: 'string', description: 'Optional cron expression (informational; interval_seconds drives runs).' },
    ],
  },
  {
    type: 'on_create',
    label: 'On Create Trigger',
    kind: 'on_create',
    category: 'trigger',
    description: 'Entry point fired when a matching target is created. Arm it per engagement in Schedules, which reads this kind.',
    params: [
      {
        name: 'target_kind',
        type: 'string',
        oneOf: ['domain', 'subdomain', 'ip', 'cidr', 'url'],
        default: 'domain',
        description: 'Target kind whose creation fires this workflow.',
      },
    ],
  },
  {
    type: 'if',
    label: 'If',
    kind: 'if',
    category: 'control',
    description: 'Branch on an expression evaluated against the upstream node output.',
    params: [
      {
        name: 'expression',
        type: 'string',
        description:
          'Condition over the upstream output row, read as `data`, e.g. data.status === "open" && data.count > 0. Supports literals, data.field and data.list[0] paths, comparisons, && || ! ??, + - * / %, ?: and the helpers String, Number, Boolean, includes, startsWith, endsWith, toLowerCase, toUpperCase, trim and new RegExp("...").test(...). {{ }} templates are resolved first.',
      },
    ],
  },
  {
    type: 'loop',
    label: 'Loop',
    kind: 'loop',
    category: 'control',
    description: 'Iterate the body over a newline/JSON list resolved from a template.',
    params: [{ name: 'source', type: 'string' }],
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
      {
        name: 'agent',
        type: 'string',
        oneOf: ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'hermes'],
        default: 'claude',
        description:
          'Which agent CLI runs this node, headless. Claude captures structured output via MCP; others must print a ```json block for it to be parsed.',
      },
      { name: 'prompt', type: 'string', ui: 'textarea' },
      {
        name: 'allow_unrestricted_cli',
        label: 'Allow an unrestricted CLI',
        type: 'boolean',
        default: false,
        description:
          'Turn on to run cursor or hermes, whose own shell and file tools cannot be locked down when they run headless. Claude, codex, gemini and opencode never need it.',
        warning: 'The agent reads target output. A prompt injected there could make cursor or hermes run commands on this machine.',
      },
    ],
  },
  {
    type: 'set_variable',
    label: 'Set Variable',
    kind: 'set_variable',
    category: 'logic',
    description: 'Assign run variables (referenced downstream as {{ vars.name }}).',
    params: [
      {
        name: 'variables',
        type: 'string',
        ui: 'code',
        description: 'JSON map of name → value. Values may use templates, e.g. {"host": "{{ target.value }}"}.',
      },
    ],
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
      { name: 'data_type', type: 'string', oneOf: ['subdomain', 'open_port', 'technology', 'raw_output'], default: 'raw_output' },
      { name: 'field', type: 'string', description: 'Row field holding the value to save.', default: 'value' },
    ],
    outputs: ['saved', 'data_type'],
  },
  {
    type: 'save_to_finding',
    label: 'Save to Finding',
    kind: 'save_to_finding',
    category: 'data',
    description: 'Record upstream rows as engagement findings. Every field is a template evaluated per row, with {{ row.<field> }} bound to the row in hand.',
    params: [
      { name: 'title', type: 'string', description: 'e.g. Secret in {{ row.file }}. Falls back to a name-like field on the row.' },
      { name: 'severity', type: 'string', oneOf: ['critical', 'high', 'medium', 'low', 'info'], default: 'medium' },
      { name: 'description', type: 'string', description: 'The short what-and-why.' },
      { name: 'details', type: 'string', description: 'The evidence. Defaults to the whole row.' },
      { name: 'target', type: 'string', description: 'Asset value this is found on. Defaults to the run target.' },
    ],
    outputs: ['id', 'title', 'severity', 'status', 'created'],
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    kind: 'http_request',
    category: 'integration',
    description:
      'Perform an HTTP request; the response becomes this node’s output. Internal addresses (localhost, private networks, cloud metadata) are refused unless "Allow internal addresses" is on.',
    params: [
      { name: 'method', type: 'string', oneOf: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
      { name: 'url', type: 'string', required: true, description: 'http or https only. Up to 5 redirects are followed.' },
      {
        name: 'headers',
        type: 'string',
        ui: 'textarea',
        description: 'JSON object of request headers. Values may use {{ }} placeholders.',
      },
      {
        name: 'body',
        type: 'string',
        ui: 'textarea',
        description: 'Placeholders are JSON-escaped in a json body and URL-encoded in a form body.',
      },
      { name: 'body_type', type: 'string', oneOf: ['json', 'form', 'raw'], default: 'json' },
      { name: 'timeout', type: 'number', default: 30000, description: 'Request timeout in milliseconds.' },
      {
        name: 'allow_internal',
        label: 'Allow internal addresses',
        type: 'boolean',
        default: false,
        description:
          'Turn on to test an internal target: loopback, private and link-local networks, including cloud metadata. The engine’s own port stays blocked.',
        warning: 'Only for targets you mean to reach. An imported workflow or a redirect could otherwise reach your own network.',
      },
    ],
    outputs: ['status', 'body'],
  },
  {
    type: 'notify',
    label: 'Notify',
    kind: 'notify',
    category: 'integration',
    description:
      'Post a message to a Discord or Slack webhook. A webhook on an internal address (localhost, private networks, cloud metadata) is refused unless "Allow internal addresses" is on.',
    params: [
      { name: 'platform', type: 'string', oneOf: ['discord', 'slack'], default: 'discord' },
      { name: 'webhook_url', type: 'string', required: true, description: 'http or https only. Up to 5 redirects are followed.' },
      { name: 'message', type: 'string', ui: 'textarea', required: true },
      { name: 'timeout', type: 'number', default: 15000, description: 'Request timeout in milliseconds.' },
      {
        name: 'allow_internal',
        label: 'Allow internal addresses',
        type: 'boolean',
        default: false,
        description:
          'Turn on to post to a webhook on an internal address, such as a local Slack relay: loopback, private and link-local networks. The engine’s own port stays blocked.',
        warning: 'Only for webhooks you mean to reach. An imported workflow or a redirect could otherwise reach your own network.',
      },
    ],
  },
  {
    type: 'geoip',
    label: 'GeoIP',
    kind: 'geoip',
    category: 'recon',
    description: 'Resolve IP geolocation via ip-api.com (no API key). Records a geolocation fact.',
    accepts: ['ip', 'domain', 'subdomain'],
    params: [
      { name: 'target', type: 'string', description: 'IP/host to geolocate. Defaults to the run target.' },
    ],
    outputs: ['country', 'city', 'lat', 'lon', 'isp', 'org', 'as'],
  },
  {
    type: 'shodan',
    label: 'Shodan',
    kind: 'shodan',
    category: 'recon',
    description: 'Shodan host lookup. Records port/technology facts. Needs the SHODAN_API_KEY secret.',
    accepts: ['ip', 'domain', 'subdomain'],
    params: [
      { name: 'target', type: 'string', description: 'IP to query. Defaults to the run target.' },
      { name: 'api_key', type: 'string', default: '{{ secrets.SHODAN_API_KEY }}', description: 'API key. Defaults to the SHODAN_API_KEY secret.' },
    ],
  },
  {
    type: 'censys',
    label: 'Censys',
    kind: 'censys',
    category: 'recon',
    description: 'Censys host view. Records port/technology facts. Needs the CENSYS_API_ID/CENSYS_API_SECRET secrets.',
    accepts: ['ip', 'domain', 'subdomain'],
    params: [
      { name: 'target', type: 'string', description: 'IP to query. Defaults to the run target.' },
      { name: 'api_id', type: 'string', default: '{{ secrets.CENSYS_API_ID }}', description: 'API ID. Defaults to the CENSYS_API_ID secret.' },
      { name: 'api_secret', type: 'string', default: '{{ secrets.CENSYS_API_SECRET }}', description: 'API secret. Defaults to the CENSYS_API_SECRET secret.' },
    ],
  },
  {
    type: 'screenshot',
    label: 'Screenshot',
    kind: 'screenshot',
    category: 'web',
    description: 'Capture a screenshot of a URL using the system headless Chrome/Chromium.',
    accepts: ['url', 'domain', 'subdomain', 'ip'],
    params: [
      { name: 'target', type: 'string', description: 'URL/host to screenshot. Defaults to the run target.' },
      { name: 'full_page', type: 'boolean', default: false },
      { name: 'timeout', type: 'number', default: 30000, description: 'Capture timeout in milliseconds.' },
    ],
    outputs: ['path'],
  },
  {
    type: 'python_script',
    label: 'Python Script',
    kind: 'python_script',
    category: 'logic',
    description: 'Run an arbitrary Python script (python3). Print a JSON dict/array for downstream rows.',
    params: [
      {
        name: 'script',
        type: 'string',
        ui: 'code',
        description: 'Python script. Templates ({{ target.value }}, {{ nodes.<id>.output }}) are substituted before it runs.',
        default: 'import json\nprint(json.dumps({"status": "ok"}))',
      },
      { name: 'timeout', type: 'number', default: 60000, description: 'Execution timeout in milliseconds.' },
    ],
  },
]

/** Build the full palette from the engine's tool manifests plus the built-in control/agent nodes. */
export function buildCatalog(listings: NodeListing[]): CatalogEntry[] {
  const tools: CatalogEntry[] = listings.map((l) => ({
    type: l.id,
    label: l.name,
    kind: 'tool',
    category: l.category,
    description: l.description,
    accepts: l.accepts,
    params: toParamSpecs(l.params ?? {}),
    ...(l.outputs !== undefined ? { outputs: l.outputs } : {}),
  }))
  return [...CONTROL_ENTRIES, ...tools]
}

export function groupByCategory(entries: CatalogEntry[]): [string, CatalogEntry[]][] {
  const order = ['trigger', 'control', 'agent', 'recon', 'scan', 'scanning', 'web', 'network', 'logic', 'data', 'integration', 'test']
  const groups = new Map<string, CatalogEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.category) ?? []
    list.push(e)
    groups.set(e.category, list)
  }
  return [...groups.entries()].sort((a, b) => {
    const ai = order.indexOf(a[0])
    const bi = order.indexOf(b[0])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}
