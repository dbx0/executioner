/** One request or response rewrite. `null` in setHeaders removes that header. Mirrors the engine's rule shape. */
export interface Rule {
  id?: string | undefined
  urlPattern: string
  stage?: 'request' | 'response' | undefined
  method?: string | undefined
  setHeaders?: Record<string, string | null> | undefined
  body?: string | undefined
  status?: number | undefined
}

export interface HeaderEntry {
  name: string
  value: string
}

/** Compiles a glob (`*` any run, `?` one character) into a regexp anchored at both ends. */
function globToRegExp(glob: string): RegExp {
  const source = [...glob].map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${source}$`, 's')
}

/** The first rule for this stage whose url glob and optional method match. */
export function matchRule(
  rules: readonly Rule[],
  req: { url: string; method: string; stage: 'request' | 'response' },
): Rule | undefined {
  return rules.find(
    (r) =>
      (r.stage ?? 'request') === req.stage &&
      (r.method === undefined || r.method.toUpperCase() === req.method.toUpperCase()) &&
      globToRegExp(r.urlPattern).test(req.url),
  )
}

/** Applies setHeaders over existing headers, case-insensitively; a `null` value removes the header. */
export function mergeHeaders(base: readonly HeaderEntry[], set: Record<string, string | null> | undefined): HeaderEntry[] {
  if (!set) return [...base]
  const lowered = new Map(Object.entries(set).map(([k, v]) => [k.toLowerCase(), v]))
  const kept = base.filter((h) => !lowered.has(h.name.toLowerCase()))
  const added: HeaderEntry[] = []
  for (const [name, value] of Object.entries(set)) if (value !== null) added.push({ name, value })
  return [...kept, ...added]
}
