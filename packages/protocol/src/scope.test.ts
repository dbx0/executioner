import { describe, expect, it } from 'vitest'
import { canonicaliseAsset, isCanonicalAsset, type CanonicalAsset } from './asset.js'
import { evaluateScope, scopePatternProblem, type ScopeRule } from './scope.js'

const asset = (kind: string, value: string): CanonicalAsset => {
  const result = canonicaliseAsset({ kind, value })
  if (!isCanonicalAsset(result)) throw new Error(result.error)
  return result
}

let counter = 0
const rule = (effect: 'include' | 'exclude', pattern: string, note = ''): ScopeRule => ({
  id: `rule-${(counter += 1)}`,
  effect,
  pattern,
  note,
})

/** The boundary SMARTFIT's SCOPE.md describes, as rules. */
const smartfit: ScopeRule[] = [
  rule('include', '*.smartfit.com.br'),
  rule('include', '*.smartfit.com'),
  rule('include', 'smartfit.com'),
  rule('exclude', 'smartfit.io', 'parked by afterTHOUGHT, Inc. — not Smart Fit'),
  rule('exclude', '*/totem/*', 'program policy 1.1 and 5.42'),
]

describe('evaluateScope', () => {
  it('reports unknown when no rules are defined at all', () => {
    const verdict = evaluateScope(asset('domain', 'smartfit.com'), [])
    expect(verdict.status).toBe('unknown')
    expect(verdict.reason).toMatch(/no scope rules/i)
  })

  it('puts a host in scope when a wildcard rule covers it', () => {
    expect(evaluateScope(asset('subdomain', 'app.smartfit.com.br'), smartfit).status).toBe('in')
  })

  it('treats a wildcard as covering the apex itself, the bug-bounty reading', () => {
    // *.smartfit.com.br in a program's scope table means the apex too, even
    // though DNS would not read it that way.
    expect(evaluateScope(asset('domain', 'smartfit.com.br'), smartfit).status).toBe('in')
  })

  it('matches a host several labels deep under a wildcard', () => {
    expect(evaluateScope(asset('subdomain', 'jump.ha.smartfit.com.br'), smartfit).status).toBe('in')
  })

  it('does not let a wildcard match a name that merely ends with the same text', () => {
    // notsmartfit.com.br must not match *.smartfit.com.br.
    expect(evaluateScope(asset('domain', 'notsmartfit.com.br'), smartfit).status).toBe('unknown')
  })

  it('reports unknown — not out — for a host no rule mentions', () => {
    // The AppSync host from the SMARTFIT tree: nobody said it was excluded,
    // nobody said it was included. That is a question, not a decision.
    const verdict = evaluateScope(asset('subdomain', 'appsync-api.us-east-1.amazonaws.com'), smartfit)
    expect(verdict.status).toBe('unknown')
    expect(verdict.reason).toMatch(/no scope rule matches/i)
  })

  it('names the rule and its note when a host is excluded', () => {
    const verdict = evaluateScope(asset('domain', 'smartfit.io'), smartfit)
    expect(verdict.status).toBe('out')
    expect(verdict.reason).toContain('smartfit.io')
    expect(verdict.reason).toContain('parked by afterTHOUGHT')
  })

  it('lets an exclusion beat an include that also matches', () => {
    const rules = [rule('include', '*.smartfit.com.br'), rule('exclude', 'admin.smartfit.com.br')]
    expect(evaluateScope(asset('subdomain', 'admin.smartfit.com.br'), rules).status).toBe('out')
  })

  it('lets a broad exclusion beat a more specific include', () => {
    // Specificity must not rescue an excluded asset: exclude always wins.
    const rules = [rule('include', 'app.smartfit.com.br'), rule('exclude', '*.smartfit.com.br')]
    expect(evaluateScope(asset('subdomain', 'app.smartfit.com.br'), rules).status).toBe('out')
  })

  it('prefers the longest matching include when reporting which rule applied', () => {
    const broad = rule('include', '*.smartfit.com.br')
    const narrow = rule('include', 'app.smartfit.com.br')
    const verdict = evaluateScope(asset('subdomain', 'app.smartfit.com.br'), [broad, narrow])
    expect(verdict.ruleId).toBe(narrow.id)
  })

  it('gives a url the verdict of the host it lives on', () => {
    const verdict = evaluateScope(asset('url', 'https://app.smartfit.com.br/api/locations'), smartfit)
    expect(verdict.status).toBe('in')
  })

  it('excludes a url by path pattern even when its host is in scope', () => {
    const verdict = evaluateScope(asset('url', 'https://app.smartfit.com.br/totem/auth/new'), smartfit)
    expect(verdict.status).toBe('out')
    expect(verdict.reason).toContain('program policy')
  })

  it('flags a url on a host nobody vouched for', () => {
    const verdict = evaluateScope(
      asset('url', 'https://qrfo53hqq5frrfmgr2o35ewfli.appsync-api.us-east-1.amazonaws.com/graphql'),
      smartfit,
    )
    expect(verdict.status).toBe('unknown')
  })

  it('puts an ip inside an included cidr in scope', () => {
    const rules = [rule('include', '54.234.0.0/16')]
    expect(evaluateScope(asset('ip', '54.234.85.144'), rules).status).toBe('in')
  })

  it('leaves an ip outside every included cidr unknown', () => {
    const rules = [rule('include', '10.0.0.0/8')]
    expect(evaluateScope(asset('ip', '54.234.85.144'), rules).status).toBe('unknown')
  })

  it('puts a cidr fully inside an included cidr in scope', () => {
    const rules = [rule('include', '10.0.0.0/8')]
    expect(evaluateScope(asset('cidr', '10.1.0.0/16'), rules).status).toBe('in')
  })

  it('does not put a cidr in scope when it only partly overlaps the rule', () => {
    const rules = [rule('include', '10.1.0.0/16')]
    expect(evaluateScope(asset('cidr', '10.0.0.0/8'), rules).status).toBe('unknown')
  })

  it('ignores a hostname rule when judging an ip', () => {
    expect(evaluateScope(asset('ip', '54.234.85.144'), smartfit).status).toBe('unknown')
  })
})

describe('scopePatternProblem', () => {
  it('accepts a hostname', () => {
    expect(scopePatternProblem('smartfit.com')).toBeNull()
  })

  it('accepts a wildcard hostname', () => {
    expect(scopePatternProblem('*.smartfit.com.br')).toBeNull()
  })

  it('accepts a network', () => {
    expect(scopePatternProblem('10.0.0.0/8')).toBeNull()
  })

  it('accepts a url glob, which is how a path is excluded', () => {
    expect(scopePatternProblem('*/totem/*')).toBeNull()
  })

  it('accepts a full url', () => {
    expect(scopePatternProblem('https://app.smartfit.com.br/totem')).toBeNull()
  })

  it('rejects a vulnerability class, which describes a bug and not an asset', () => {
    // The BMW parse stored seven of these. They can never match an asset, so
    // they sat in the table looking like a boundary while doing nothing.
    const problem = scopePatternProblem('class:dos-ecu-bus-flooding')
    expect(problem).not.toBeNull()
    expect(problem).toMatch(/asset/i)
  })

  it('rejects an invented namespace prefix', () => {
    expect(scopePatternProblem('device:remaining-functions')).not.toBeNull()
    expect(scopePatternProblem('asset:bmw-group-aftermarket-products')).not.toBeNull()
  })

  it('rejects a bare app store id', () => {
    expect(scopePatternProblem('1519034860')).not.toBeNull()
  })

  it('rejects a name with no dot, which cannot be a host anyone can reach', () => {
    expect(scopePatternProblem('remaining-functions')).not.toBeNull()
  })

  it('rejects a bare wildcard that would match the whole internet', () => {
    expect(scopePatternProblem('*')).not.toMatch(/^$/)
    expect(scopePatternProblem('*')).not.toBeNull()
  })

  it('rejects whitespace', () => {
    expect(scopePatternProblem('   ')).not.toBeNull()
  })

  it('names the shapes it accepts, so the error can be acted on', () => {
    const problem = scopePatternProblem('class:duplicate') ?? ''
    expect(problem).toMatch(/example\.com/)
  })

  it('still accepts an android package name, which is shaped like a host', () => {
    // Nothing can distinguish these from hostnames by syntax alone. The prompt
    // is what must keep them out; validation cannot.
    expect(scopePatternProblem('de.bmw.connected.mobile20.row')).toBeNull()
  })
})
