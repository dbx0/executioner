/** The subset of an EmitSpec the parsers need. Kept structural so tests need no full manifest. */
export interface ParseSpec {
  parser: 'json' | 'regex' | 'file' | 'whois'
  records?: string
  pattern?: string
  format?: 'json' | 'jsonl'
}

type Record_ = Record<string, unknown>

const asRecords = (value: unknown): Record_[] => {
  if (Array.isArray(value)) return value.filter((v): v is Record_ => isObject(v))
  return isObject(value) ? [value] : []
}

const isObject = (v: unknown): v is Record_ => v !== null && typeof v === 'object' && !Array.isArray(v)

interface Cursor {
  value: unknown
  /** The object key this value was reached through, when the last step was an object wildcard. */
  key?: string
}

/**
 * Select records from a JSON document by a small path grammar: dotted keys plus
 * a `*` wildcard (also written `[*]`) that expands an array (each element) or an
 * object (each value, carrying the key as `_key`). `[n]` indexes an array.
 * This lets tools with nested object maps — e.g. whatweb's `plugins{}` — emit one
 * record per entry: `$[*].plugins.*` yields `{_key: <plugin>, ...<pluginValue>}`.
 */
function selectRecords(doc: unknown, recordsPath: string): Record_[] {
  const normalized = recordsPath
    .replace(/^\$\.?/, '')
    .replace(/\[(\*|\d+)\]/g, '.$1')
    .replace(/^\./, '')
  const segments = normalized === '' ? [] : normalized.split('.').filter((s) => s !== '')

  let frontier: Cursor[] = [{ value: doc }]
  for (const seg of segments) {
    const next: Cursor[] = []
    for (const node of frontier) {
      const v = node.value
      if (seg === '*') {
        if (Array.isArray(v)) for (const el of v) next.push({ value: el })
        else if (isObject(v)) for (const [k, el] of Object.entries(v)) next.push({ value: el, key: k })
      } else if (Array.isArray(v)) {
        const idx = Number(seg)
        if (Number.isInteger(idx) && v[idx] !== undefined) next.push({ value: v[idx], ...(node.key !== undefined ? { key: node.key } : {}) })
      } else if (isObject(v)) {
        const el = v[seg]
        if (el !== undefined) next.push({ value: el, ...(node.key !== undefined ? { key: node.key } : {}) })
      }
    }
    frontier = next
  }

  const out: Record_[] = []
  for (const node of frontier) {
    const withKey = (r: Record_): Record_ => (node.key !== undefined ? { _key: node.key, ...r } : r)
    if (Array.isArray(node.value)) {
      for (const el of node.value) if (isObject(el)) out.push(withKey(el))
    } else if (isObject(node.value)) {
      out.push(withKey(node.value))
    } else if (node.key !== undefined) {
      out.push({ _key: node.key, value: node.value })
    }
  }
  return out
}

function jsonRecords(input: string, recordsPath: string): Record_[] {
  const trimmed = input.trim()
  if (trimmed === '') return []
  // Whole-document JSON first: an object or array, optionally addressed by a path.
  try {
    return selectRecords(JSON.parse(trimmed), recordsPath)
  } catch {
    // Fall through to JSON-lines.
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown)
    .filter(isObject)
}

function regexRecords(input: string, pattern: string): Record_[] {
  const re = new RegExp(pattern, 'g')
  const out: Record_[] = []
  for (const match of input.matchAll(re)) {
    if (match.groups) out.push({ ...match.groups })
  }
  return out
}

/**
 * Parses raw `whois` output into ONE structured record with a stable set of
 * keys (registrar, registrant, dates, name servers, status, dnssec, emails).
 * Every key is always present (empty string when absent) so the fact mapping
 * never drops the record for a missing field, and multi-value fields (name
 * servers, statuses, emails) are de-duplicated and joined. Registrar/registry
 * fields vary in label across TLDs, so several aliases are accepted per field.
 */
function whoisRecord(input: string): Record_[] {
  const clean = input.replace(/\r/g, '')
  const lines = clean.split('\n')
  const kv = (line: string): [string, string] | null => {
    const m = line.match(/^\s*([^:]+):\s*(.+?)\s*$/)
    return m && m[1] !== undefined && m[2] !== undefined ? [m[1].trim().toLowerCase(), m[2].trim()] : null
  }
  const first = (labels: string[]): string => {
    for (const line of lines) {
      const pair = kv(line)
      if (pair && labels.includes(pair[0]) && pair[1] !== '') return pair[1]
    }
    return ''
  }
  const nameServers: string[] = []
  const statuses: string[] = []
  const emails: string[] = []
  for (const line of lines) {
    const pair = kv(line)
    if (pair === null) continue
    const [key, val] = pair
    if (key === 'name server' || key === 'nserver') nameServers.push(val.toLowerCase().split(/\s+/)[0] ?? val)
    else if (key === 'domain status' || key === 'status') statuses.push(val.replace(/\s*https?:\/\/\S+/i, '').trim())
    const em = val.match(/[\w.+-]+@[\w.-]+\.\w+/)
    if (em && /(mail|email|abuse|contact)/.test(key)) emails.push(em[0].toLowerCase())
  }
  const uniq = (a: string[]): string => [...new Set(a.filter((x) => x !== ''))].join(', ')
  return [
    {
      registrar: first(['registrar', 'sponsoring registrar']),
      registrant: first(['registrant organization', 'registrant', 'org', 'organization', 'registrant name']),
      creation_date: first(['creation date', 'created', 'created on', 'registered on', 'registration time']),
      updated_date: first(['updated date', 'last updated', 'last modified', 'modified']),
      expiry_date: first([
        'registry expiry date',
        'registrar registration expiration date',
        'expiry date',
        'expiration date',
        'expires',
        'expires on',
        'paid-till',
      ]),
      name_servers: uniq(nameServers),
      domain_status: uniq(statuses),
      dnssec: first(['dnssec']),
      emails: uniq(emails),
    },
  ]
}

/** Turn raw output into a stream of records. The parser selects how; mapping is shared downstream. */
export function extractRecords(spec: ParseSpec, input: string): Record_[] {
  if (spec.parser === 'regex') {
    if (spec.pattern === undefined) throw new Error('regex parser requires a pattern')
    return regexRecords(input, spec.pattern)
  }
  if (spec.parser === 'file') {
    if (spec.format === 'jsonl') return jsonRecords(input, '$')
    return asRecords(JSON.parse(input.trim()))
  }
  if (spec.parser === 'whois') {
    return whoisRecord(input)
  }
  return jsonRecords(input, spec.records ?? '$')
}
