export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One line of an app log file: a single JSON object per line. */
export interface LogLine {
  /** ISO timestamp. */
  t: string
  lvl: LogLevel
  /** `main`, `renderer`, `preload` or `engine:<id>`, with an optional `/<subsystem>` suffix. */
  src: string
  msg: string
  data?: Record<string, unknown>
}

export const SECRET_MASK = '[secret]'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && Object.hasOwn(LEVEL_RANK, value)

/** True when a line at `lvl` should be kept given the minimum level `min`. */
export function levelEnabled(min: LogLevel, lvl: LogLevel): boolean {
  return LEVEL_RANK[lvl] >= LEVEL_RANK[min]
}

/** Serialise a line as JSON with no trailing newline. */
export function formatLine(line: LogLine): string {
  return JSON.stringify(line)
}

/** Parse one log line; null for non-JSON text or an object that is not a log line. */
export function parseLine(text: string): LogLine | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.t !== 'string' || !isLogLevel(v.lvl) || typeof v.src !== 'string' || typeof v.msg !== 'string') return null
  if (v.data !== undefined && (typeof v.data !== 'object' || v.data === null || Array.isArray(v.data))) return null
  return value as LogLine
}

/** Known values shorter than this are ignored so a one-letter secret cannot mask every occurrence. */
const MIN_SECRET_LENGTH = 4

const SECRET_FIELD = /pass(word)?|secret|token|api[-_]?key|authorization/i

/** Patterns applied in order; the Authorization rule runs first so it takes its `Bearer` scheme with it. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, SECRET_MASK],
  [/(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s"',;]+/gi, `$1${SECRET_MASK}`],
  [/(\bbearer\s+)[\w.~+/=-]+/gi, `$1${SECRET_MASK}`],
  [/((?:^|[^A-Za-z0-9])[A-Za-z0-9_-]*(?:key|token|secret|passw(?:or)?d)=)[^&\s"']+/gi, `$1${SECRET_MASK}`],
  [/\b(?:censys_|sk-|ghp_|xox[a-z]-)[A-Za-z0-9_-]{6,}/g, SECRET_MASK],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:)[^\s/@"']+(?=@)/gi, `$1${SECRET_MASK}`],
]

/** Masks secrets in log lines: known values, well-known patterns and sensitive field names. */
export class Redactor {
  private values: string[] = []

  constructor(values: string[] = []) {
    this.setValues(values)
  }

  /** Replace the known-value list. Longest values go first so a value never leaves a tail behind. */
  setValues(values: string[]): void {
    this.values = [...new Set(values)].filter((v) => v.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length)
  }

  /** Returns a masked copy; the input is not modified. */
  redact(line: LogLine): LogLine {
    const out: LogLine = { ...line, msg: this.string(line.msg) }
    if (line.data !== undefined) out.data = this.walk(line.data, new WeakSet()) as Record<string, unknown>
    return out
  }

  private string(text: string): string {
    let out = text
    for (const value of this.values) out = out.split(value).join(SECRET_MASK)
    for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
    return out
  }

  /** `path` holds the objects on the way down, so a cycle is cut while shared (non-cyclic) references still copy. */
  private walk(value: unknown, path: WeakSet<object>): unknown {
    if (typeof value === 'string') return this.string(value)
    if (typeof value === 'object' && value !== null) {
      if (path.has(value)) return '[circular]'
      path.add(value)
      try {
        if (Array.isArray(value)) return value.map((item) => this.walk(item, path))
        const out: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) out[key] = SECRET_FIELD.test(key) ? SECRET_MASK : this.walk(item, path)
        return out
      } finally {
        path.delete(value)
      }
    }
    return value
  }
}
