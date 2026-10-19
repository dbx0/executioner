import { z } from 'zod'
import { isIP } from 'node:net'
import { cidrContains, type CanonicalAsset } from './asset.js'
import type { ScopeStatus } from './target.js'

export const scopeEffectSchema = z.enum(['include', 'exclude'])
export type ScopeEffect = z.infer<typeof scopeEffectSchema>

/**
 * One line of an engagement's boundary. Patterns come in three shapes:
 *
 * - `*.example.com` / `example.com` — a hostname, matching a host or the host a
 *   url lives on. A wildcard covers the apex too, which is how a program's scope
 *   table is read even though DNS would disagree.
 * - `10.0.0.0/8` — a network, matching an ip inside it or a network within it.
 * - a pattern containing a slash, such as a glob over `/totem/`, is matched
 *   against a url's full value. This is how a path-level exclusion is written.
 */
export const scopeRuleSchema = z.object({
  id: z.string().min(1),
  effect: scopeEffectSchema,
  pattern: z.string().min(1),
  note: z.string().default(''),
})

export type ScopeRule = z.infer<typeof scopeRuleSchema>

export interface ScopeVerdict {
  status: ScopeStatus
  /** The rule that decided it, or null when nothing matched. */
  ruleId: string | null
  /** Human sentence for the badge tooltip; always populated. */
  reason: string
}

const isNetworkPattern = (pattern: string): boolean => /^[0-9a-f.:]+\/\d+$/i.test(pattern)
const isUrlPattern = (pattern: string): boolean => pattern.includes('/')

function globToRegExp(pattern: string): RegExp {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`, 'i')
}

function matchesHostname(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const apex = pattern.slice(2).toLowerCase()
    // The dot matters: notsmartfit.com.br must not match *.smartfit.com.br.
    return host === apex || host.endsWith(`.${apex}`)
  }
  return host === pattern.toLowerCase()
}

function matches(rule: ScopeRule, asset: CanonicalAsset): boolean {
  const pattern = rule.pattern.trim()

  if (isNetworkPattern(pattern)) {
    if (asset.kind !== 'ip' && asset.kind !== 'cidr') return false
    return cidrContains(pattern, asset.value)
  }

  if (isUrlPattern(pattern)) {
    return asset.kind === 'url' && globToRegExp(pattern).test(asset.value)
  }

  // A hostname rule judges the host an asset lives on, so a url inherits the
  // verdict of its host without anyone writing a second rule for it.
  return asset.host !== null && matchesHostname(pattern, asset.host)
}

const describe = (rule: ScopeRule): string =>
  rule.note.length > 0 ? `${rule.pattern} (${rule.note})` : rule.pattern

/**
 * Judges an asset against the engagement's boundary.
 *
 * An exclusion always wins, however narrow the include that also matches: a
 * host someone deliberately ruled out must not be rescued by a more specific
 * rule. Among includes the longest pattern wins, so the verdict names the rule
 * an operator would expect. Nothing matching at all is `unknown`, never `out` —
 * a scope paste is routinely incomplete, and "nobody said" is not "no".
 */
export function evaluateScope(asset: CanonicalAsset, rules: ScopeRule[]): ScopeVerdict {
  if (rules.length === 0) {
    return { status: 'unknown', ruleId: null, reason: 'no scope rules defined yet' }
  }

  const matching = rules.filter((rule) => matches(rule, asset))

  const excluded = matching.filter((rule) => rule.effect === 'exclude')
  if (excluded.length > 0) {
    const rule = excluded.reduce((a, b) => (b.pattern.length > a.pattern.length ? b : a))
    return { status: 'out', ruleId: rule.id, reason: `excluded by ${describe(rule)}` }
  }

  const included = matching.filter((rule) => rule.effect === 'include')
  if (included.length > 0) {
    const rule = included.reduce((a, b) => (b.pattern.length > a.pattern.length ? b : a))
    return { status: 'in', ruleId: rule.id, reason: `in scope by ${describe(rule)}` }
  }

  return { status: 'unknown', ruleId: null, reason: `no scope rule matches ${asset.value}` }
}

/** The pattern shapes the matcher understands, quoted back in every rejection. */
const ACCEPTED_SHAPES =
  'a host (example.com), a wildcard (*.example.com), a network (10.0.0.0/8), or a url or path glob (*/admin/*)'

/**
 * Explains why a pattern could never match an asset, or null when it is usable.
 *
 * Scope rules describe WHERE you may test, not WHAT counts as a bug. A program's
 * out-of-scope section is usually a mix of the two, and an agent reading it will
 * cheerfully file "denial of service by flooding the ECU" as a rule — as one did
 * on the BMW program, storing seven such rules that could never match anything
 * and left the engagement looking bounded when it was not. Policy like that
 * belongs in the engagement's notes; only assets belong here.
 *
 * A syntactically host-shaped string is accepted even when it is really
 * something else — an Android package such as `de.bmw.connected.mobile20.row` is
 * indistinguishable from a hostname — so this catches carelessness, not every
 * category error.
 */
export function scopePatternProblem(pattern: string): string | null {
  const text = pattern.trim()
  if (text.length === 0) return 'a scope rule needs a pattern'

  if (text === '*' || text === '*.') {
    return `"${text}" would match everything. Name ${ACCEPTED_SHAPES}.`
  }

  // A url or path glob: anything with a slash is matched against a url's value.
  if (text.includes('/')) return null

  const host = text.startsWith('*.') ? text.slice(2) : text

  // A prefix like `class:` or `device:` is an invented namespace, not an asset.
  if (host.includes(':')) {
    return `"${text}" is not an asset. Scope rules say where you may test — ${ACCEPTED_SHAPES}. A rule about a kind of bug belongs in the engagement notes, not here.`
  }

  // A run of digits and dots that is not an address is an identifier of some
  // other kind — an App Store id, a version — and never an asset to test.
  if (/^[\d.]+$/.test(host) && isIP(host) === 0) {
    return `"${text}" is a number, not a host or a network. Name ${ACCEPTED_SHAPES}.`
  }

  if (!host.includes('.')) {
    return `"${text}" is not a host anyone can reach. Name ${ACCEPTED_SHAPES}.`
  }

  if (!/^[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return `"${text}" is not a valid host pattern. Name ${ACCEPTED_SHAPES}.`
  }

  return null
}
