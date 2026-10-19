export type PlaceholderContext = Record<string, unknown>

// The root is a plain identifier; the path into it may hold hyphens, because
// tools name fields that way (nuclei's `template-id`, `matched-at`).
const PLACEHOLDER = /\{\{\s*([a-z0-9_]+(?:\.[a-z0-9_-]+)*)\s*\}\}/gi

/**
 * Walk a dotted path through nested plain objects. Returns undefined if any hop
 * is missing. Only own properties count, so `{{ target.constructor }}` names
 * nothing rather than reaching into the prototype chain.
 */
export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Replace every `{{ root.rest }}` placeholder against the context. The first
 * segment selects a context root (target, params, record); the remainder is a
 * dotted path into it. Returns undefined if any referenced value is missing, so
 * callers can distinguish "nothing to substitute" from "empty string".
 *
 * `encode`, when given, transforms each substituted value: a caller pasting
 * values into source code passes an escaper so a value stays data.
 */
export function interpolate(
  template: string,
  ctx: PlaceholderContext,
  encode: (value: string) => string = (value) => value,
): string | undefined {
  let missing = false
  const out = template.replace(PLACEHOLDER, (_match, expr: string) => {
    const [root, ...rest] = expr.split('.')
    const base = Object.hasOwn(ctx, root as string) ? ctx[root as string] : undefined
    const value = rest.length === 0 ? base : resolvePath(base, rest.join('.'))
    if (value === undefined || value === null) {
      missing = true
      return ''
    }
    return encode(String(value))
  })
  return missing ? undefined : out
}

/**
 * Escape a value for use inside a Python string literal, single- or
 * double-quoted, triple-quoted or an f-string. Quotes, backslashes and line
 * breaks cannot end the literal, and braces are written as `\x7b`/`\x7d` so an
 * f-string never reads them as an expression. The protection holds only inside
 * a literal: a placeholder written bare into code is the script author's call.
 */
export function escapePythonString(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) as number
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '{' || ch === '}' || code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out
}

/**
 * Escape a value for use inside a JSON string literal. Quotes, backslashes and
 * control characters come out as JSON escapes, so a value cannot close the
 * string it sits in and add keys of its own. As with the Python escaper, the
 * protection holds inside a quoted string: a bare placeholder keeps a number a
 * number, and anything else there makes the JSON fail to parse rather than say
 * something new.
 */
export function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}
