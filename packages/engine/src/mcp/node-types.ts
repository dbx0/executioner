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
    label: 'Start',
    kind: 'manual',
    category: 'trigger',
    description:
      'Where the workflow begins. Every workflow has exactly one, wired to the first nodes. It takes no settings: when a workflow runs (by hand, on a schedule, when a target is added) is set on the Actions page, never in the graph.',
    params: [],
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
    description:
      'Run every downstream node once per item. Set source to {{ nodes.<nodeId>.rows }} to walk the parsed rows of an upstream node; the body reads {{ loop.item.<field> }}. A source that resolves to a JSON array or to lines of text is walked item by item, read as {{ loop.item }}.',
    params: [
      param({ name: 'source', type: 'string', description: 'Usually {{ nodes.<nodeId>.rows }}.' }),
      param({ name: 'max_items', type: 'number', description: 'Stop after this many items. Leave empty to walk them all.' }),
    ],
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
    description:
      'Persist a value from upstream rows to the workflow target. Only for values no node saved: tool and recon nodes already save their own results, so do not put this after one.',
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
    description: 'Censys Platform host view. Needs the CENSYS_API_TOKEN secret (CENSYS_ORG_ID optional, for paid plans).',
    params: [
      param({ name: 'target', type: 'string', description: 'IP to query. Defaults to the run target.' }),
      param({ name: 'api_token', type: 'string', default: '{{ secrets.CENSYS_API_TOKEN }}' }),
      param({ name: 'org_id', type: 'string', default: '{{ secrets.CENSYS_ORG_ID }}' }),
    ],
  },
  {
    type: 'tls_cert',
    label: 'TLS Certificate',
    kind: 'tls_cert',
    category: 'recon',
    description: 'Read the certificate a host serves (issuer, names, expiry) with one TLS handshake. Records a certificate fact. No external tool.',
    params: [
      param({ name: 'target', type: 'string', description: 'Host, host:port or URL. Defaults to the run target.' }),
      param({ name: 'port', type: 'number', description: 'Defaults to the port in the target, or 443.' }),
      param({ name: 'timeout', type: 'number', default: 15000 }),
    ],
    outputs: ['host', 'port', 'subject_cn', 'issuer', 'not_before', 'not_after', 'sans', 'days_left', 'expired'],
  },
  {
    type: 'dns_records',
    label: 'DNS Records',
    kind: 'dns_records',
    category: 'recon',
    description:
      'Resolve a name and record each answer set as a dns_record fact; addresses become child ip targets. On an IP it reverse-resolves (PTR) and saves the names as targets. One output row per answer. No external tool.',
    params: [
      param({ name: 'target', type: 'string', description: 'Name or IP. Defaults to the run target.' }),
      param({ name: 'record_types', type: 'string', default: 'A,AAAA,CNAME,MX,NS,TXT', description: 'Comma separated. Ignored for an IP.' }),
    ],
    outputs: ['name', 'type', 'value'],
  },
  {
    type: 'asn',
    label: 'ASN Ranges',
    kind: 'asn',
    category: 'recon',
    description:
      'Find the AS announcing an IP (or take an AS number) and list its announced ranges via RIPEstat (no API key). One output row per range. Ranges are saved as cidr targets only when there are at most max_prefixes.',
    params: [
      param({ name: 'target', type: 'string', description: 'IP or AS number such as AS15169. Defaults to the run target.' }),
      param({ name: 'max_prefixes', type: 'number', default: 100 }),
      param({ name: 'ipv6', type: 'boolean', default: false }),
      param({ name: 'timeout', type: 'number', default: 30000 }),
    ],
    outputs: ['asn', 'holder', 'prefix'],
  },
  {
    type: 'cloud_buckets',
    label: 'Cloud Buckets',
    kind: 'cloud_buckets',
    category: 'recon',
    description:
      'Guess bucket names from a keyword and check which exist on S3, Google Cloud Storage and Azure. One output row per bucket found, with access = open or protected. Found buckets are saved as url targets.',
    params: [
      param({ name: 'keyword', type: 'string', description: 'Defaults to the registrable label of the run target (acme for acme.com).' }),
      param({ name: 'wordlist', type: 'string', description: 'Extra words tried as <keyword>-<word>, one per line.' }),
      param({ name: 'timeout', type: 'number', default: 10000 }),
    ],
    outputs: ['provider', 'bucket', 'url', 'access', 'status_code'],
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
      param({
        name: 'headers',
        type: 'string',
        description: 'JSON object of request headers added to requests the page makes to the target host, never to third parties it loads. Values may use {{ }} placeholders.',
      }),
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
      'Last resort, for a step no node or combination of nodes can do. Runs a Python script (python3); print a JSON dict/array for downstream rows. Put {{ }} placeholders inside a string literal: values are inserted escaped, as text.',
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
