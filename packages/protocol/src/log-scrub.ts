import type { LogLine } from './log.js'

/** Hosts the app itself talks to, plus loopback; these are never engagement data. */
export const SCRUB_ALLOWLIST: readonly string[] = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'api.platform.censys.io',
  'api.shodan.io',
  'ip-api.com',
  'api.anthropic.com',
  'api.openai.com',
  'localhost',
  '127.0.0.1',
  '::1',
]

/** Free-text fields that can hold anything: replaced by a character count. */
export const TEXT_FIELDS: readonly string[] = ['text', 'prompt', 'output', 'body', 'finding']
/** Fields holding an engagement folder path. */
export const PATH_FIELDS: readonly string[] = ['path', 'dir', 'root']
/** Fields holding an engagement name. */
export const ENGAGEMENT_FIELDS: readonly string[] = ['engagement']

/**
 * Fields holding a route or endpoint (`/api/workflows/:id`), never a file: their
 * slashes are not treated as filesystem paths.
 */
export const ROUTE_FIELDS: readonly string[] = ['route', 'endpoint']

const MAX_DEPTH = 20

// One path segment: no whitespace, quotes, brackets, separators, or the colon
// that starts a stack frame's `:line:col`.
const SEG = `[^\\s"'<>()\\[\\]{},;:|*?\\\\/]+`
const WIN_PATH_RE = new RegExp(`(?<![\\w])[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}`)
const TILDE_PATH_RE = new RegExp(`(?<![\\w~])~[\\\\/](?:${SEG}[\\\\/])*${SEG}`)
const POSIX_PATH_RE = new RegExp(`(?<![\\w.~:/\\\\-])/(?:${SEG}/)+${SEG}`)
/**
 * A path right after a quote runs to the matching closing quote, spaces and
 * all: Node's fs errors quote the path (`open '/home/u/Acme Corp/x.json'`).
 * It still needs a second separator, the same as an unquoted path.
 */
const QUOTED_PATH_RE = /(?<=(?<q>['"`]))(?:\/|~[\\/]|[A-Za-z]:[\\/])[^'"`\r\n]*?[\\/][^'"`\r\n]*?(?=\k<q>)/
/** Paths into installed code, kept so stack traces stay readable. */
const CODE_PATH_RE = /node_modules|\.asar|resources[\\/]engine/i

const URL_RE = /(?<![a-zA-Z0-9+.-])[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>\\]+/
const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
const IPV6_RE = /(?<![\w:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])/
const IPV4_RE = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w])/
const HOST_RE = /(?<![\w.-])[\w-]+(?:\.[\w-]+)+(?![\w-])/
const tokens = (res: RegExp[], names: string[]): RegExp =>
  new RegExp(res.map((r, i) => `(?<${names[i] ?? ''}>${r.source})`).join('|'), 'g')
const TOKEN_RE = tokens(
  [URL_RE, QUOTED_PATH_RE, WIN_PATH_RE, TILDE_PATH_RE, POSIX_PATH_RE, EMAIL_RE, IPV6_RE, IPV4_RE, HOST_RE],
  ['url', 'quoted', 'win', 'tilde', 'posix', 'email', 'v6', 'v4', 'host'],
)
/** The same without filesystem paths, for URL paths and route fields. */
const TOKEN_NO_PATH_RE = tokens([URL_RE, EMAIL_RE, IPV6_RE, IPV4_RE, HOST_RE], ['url', 'email', 'v6', 'v4', 'host'])

const URL_PARTS = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)(:\d+)?([^?#]*)(\?[^#]*)?(?:#.*)?$/

const isIpv4 = (s: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every((p) => Number(p) <= 255)

function isIpv6(s: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(s) || !s.includes(':')) return false
  const groups = s.split('::')
  if (groups.length > 2) return false
  const count = (part = '') => (part === '' ? 0 : part.split(':').length)
  const parts = groups.flatMap((g) => (g === '' ? [] : g.split(':')))
  if (parts.some((p) => p.length === 0 || p.length > 4)) return false
  return groups.length === 2 ? count(groups[0]) + count(groups[1]) <= 7 : count(groups[0]) === 8
}

/** File extensions that look like a TLD; a dotted token ending in one is a file name, not a host. */
const FILE_EXTENSIONS = new Set(
  ('js ts tsx jsx mjs cjs json jsonl md txt log sh ps1 bat py rb go rs zip gz tar png jpg jpeg gif svg ico html htm css ' +
    'toml yml yaml xml lock node so dll exe dylib map env ini cfg conf pem key crt csv').split(' '),
)

/**
 * A bare dotted token is a host when its last label is alphabetic (2+ letters, ICANN or not) and is not a file
 * extension, and the token is not a call such as `Object.run (`. Versions and timestamps end in digits.
 */
function isBareHost(tok: string, before: string, after: string): boolean {
  const last = tok.slice(tok.lastIndexOf('.') + 1).toLowerCase()
  if (!/^[a-z]{2,}$/.test(last) || FILE_EXTENSIONS.has(last)) return false
  if (after.startsWith('(')) return false
  return !(/(?:^|\s)at $/.test(before) && after.startsWith(' ('))
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces engagement data in log lines with stable placeholders. One instance per export so the same
 * value always maps to the same placeholder. The mapping lives in private fields and is never exposed.
 */
export class Scrubber {
  readonly #home: RegExp | null
  /** The home path with each separator as `-`, as agent CLIs name per-project folders. */
  readonly #dashHome: RegExp | null
  readonly #paths = new Map<string, string>()
  readonly #hosts = new Map<string, string>()
  readonly #ips = new Map<string, string>()
  readonly #emails = new Map<string, string>()
  readonly #engagements = new Map<string, string>()

  constructor(opts: { home: string }) {
    const home = opts.home.replace(/[\\/]+$/, '')
    // Windows (drive letter) and macOS (/Users) homes are case-insensitive and may use either slash.
    const flags = /^[a-z]:|^[\\/]users[\\/]/i.test(home) ? 'gi' : 'g'
    const body = home.split(/[\\/]/).map(escapeRe).join('[\\\\/]')
    this.#home = home ? new RegExp(`(?:file:/{2,3})?${body}(?![\\w.-])`, flags) : null
    // `/home/u` → `-home-u`; `C:\\Users\\bob` → `C:-Users-bob` or, with the colon dashed too, `C--Users-bob`.
    const dash = home.split(/[\\/]/).map(escapeRe).join('-').replace(/^([a-z]):/i, '$1[:-]')
    this.#dashHome = home ? new RegExp(`${dash}(?![\\w.])`, flags) : null
  }

  line(l: LogLine): LogLine {
    const out: LogLine = { ...l, msg: this.#string(l.msg) }
    if (l.data) out.data = this.#object(l.data, 0)
    return out
  }

  #placeholder(map: Map<string, string>, key: string, prefix: string): string {
    let v = map.get(key)
    if (!v) {
      v = `${prefix}-${map.size + 1}`
      map.set(key, v)
    }
    return v
  }

  #hostOrIp(host: string): string {
    const key = host.toLowerCase()
    if (SCRUB_ALLOWLIST.includes(key)) return host
    const bare = key.replace(/^\[|\]$/g, '')
    if (SCRUB_ALLOWLIST.includes(bare)) return host
    if (isIpv4(bare) || isIpv6(bare)) return this.#placeholder(this.#ips, bare, 'ip')
    return this.#placeholder(this.#hosts, key, 'host')
  }

  #url(token: string): string {
    const trail = /[.,;:!?)\]}]+$/.exec(token)?.[0] ?? ''
    const body = trail ? token.slice(0, -trail.length) : token
    const m = URL_PARTS.exec(body)
    if (!m) return token
    const [, scheme = '', host = '', port = '', path = '', query] = m
    const h = host ? this.#hostOrIp(host) : ''
    const q = query ? '?' + query.slice(1).split('&').map((p) => (p.includes('=') ? p.slice(0, p.indexOf('=') + 1) : p)).join('&') : ''
    return `${scheme}${h}${port}${this.#string(path, false)}${q}${trail}`
  }

  /** A filesystem path: a stable placeholder, unless it points into installed code. */
  #path(token: string): string {
    const trail = /[.!]+$/.exec(token)?.[0] ?? ''
    const body = trail ? token.slice(0, -trail.length) : token
    if (CODE_PATH_RE.test(body)) return token
    return this.#placeholder(this.#paths, body, 'path') + trail
  }

  #string(input: string, paths = true): string {
    let s = this.#home ? input.replace(this.#home, '~') : input
    if (this.#dashHome) s = s.replace(this.#dashHome, '~')
    return s.replace(paths ? TOKEN_RE : TOKEN_NO_PATH_RE, (tok: string, ...rest: unknown[]) => {
      // replace() hands the groups, then offset, the whole string and the named groups.
      const g = rest[rest.length - 1] as Record<string, string | undefined>
      const offset = rest[rest.length - 3] as number
      const whole = rest[rest.length - 2] as string
      const { url, quoted, win, tilde, posix, email, v6, v4, host } = g
      if (url) return this.#url(tok)
      if (quoted || win || tilde || posix) return this.#path(tok)
      if (email) return this.#placeholder(this.#emails, tok.toLowerCase(), 'email')
      if (v6) return isIpv6(tok) ? this.#hostOrIp(tok) : tok
      if (v4) return isIpv4(tok) ? this.#hostOrIp(tok) : tok
      if (host) {
        const allowed = SCRUB_ALLOWLIST.includes(tok.toLowerCase())
        return allowed || isBareHost(tok, whole.slice(Math.max(0, offset - 4), offset), whole.slice(offset + tok.length, offset + tok.length + 2)) ? this.#hostOrIp(tok) : tok
      }
      return tok
    })
  }

  #value(key: string, v: unknown, depth: number): unknown {
    if (TEXT_FIELDS.includes(key) && v !== null && v !== undefined) {
      const n = typeof v === 'string' ? v.length : (JSON.stringify(v) ?? '').length
      return `[${n} chars removed]`
    }
    if ((PATH_FIELDS.includes(key) || ENGAGEMENT_FIELDS.includes(key)) && typeof v === 'string') {
      return this.#placeholder(this.#engagements, v, 'engagement')
    }
    if (ROUTE_FIELDS.includes(key) && typeof v === 'string') return this.#string(v, false)
    return this.#any(v, depth)
  }

  #any(v: unknown, depth: number): unknown {
    if (typeof v === 'string') return this.#string(v)
    if (typeof v !== 'object' || v === null) return v
    if (depth >= MAX_DEPTH) return '[truncated]'
    if (Array.isArray(v)) return v.map((x) => this.#any(x, depth + 1))
    return this.#object(v as Record<string, unknown>, depth + 1)
  }

  #object(o: Record<string, unknown>, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) out[k] = this.#value(k, v, depth)
    return out
  }
}
