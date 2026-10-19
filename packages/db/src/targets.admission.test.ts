import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { ScopeRuleRepository } from './scope-rules.js'
import { TargetRepository } from './targets.js'

let repo: TargetRepository
let rules: ScopeRuleRepository

beforeEach(() => {
  const db = openDatabase(':memory:')
  repo = new TargetRepository(db)
  rules = new ScopeRuleRepository(db)
})

describe('TargetRepository.upsert — one host, one row', () => {
  it('collapses a host stored under both kinds into a single target', () => {
    // The SMARTFIT shape: an agent filed api-bf.bioritmo.com.br as a domain on
    // one pass and a subdomain on the next, and got two rows.
    const first = repo.upsert({ kind: 'domain', value: 'api-bf.bioritmo.com.br', source: 'agent' })
    const second = repo.upsert({ kind: 'subdomain', value: 'api-bf.bioritmo.com.br', source: 'agent' })

    expect(second.id).toBe(first.id)
    expect(repo.all().filter((t) => t.value === 'api-bf.bioritmo.com.br')).toHaveLength(1)
  })

  it('files an apex as a domain however the caller labelled it', () => {
    const apex = repo.upsert({ kind: 'subdomain', value: 'smartfit.com.br', source: 'manual' })
    expect(apex.kind).toBe('domain')
    expect(apex.apex).toBe('smartfit.com.br')
  })

  it('files a host under an apex as a subdomain however the caller labelled it', () => {
    const host = repo.upsert({ kind: 'domain', value: 'agenttech.smartfit.cloud', source: 'agent' })
    expect(host.kind).toBe('subdomain')
    expect(host.apex).toBe('smartfit.cloud')
  })

  it('folds a url that differs only by fragment into one row', () => {
    repo.upsert({ kind: 'url', value: 'https://smartfit.com/a#one', source: 'agent' })
    repo.upsert({ kind: 'url', value: 'https://smartfit.com/a#two', source: 'agent' })
    expect(repo.all().filter((t) => t.kind === 'url')).toHaveLength(1)
  })

  it('rejects a wildcard instead of storing it as an asset', () => {
    expect(() => repo.upsert({ kind: 'domain', value: '*.smartfit.com.br', source: 'agent' })).toThrow(
      /wildcard/i,
    )
  })

  it('rejects a malformed ip instead of storing it verbatim', () => {
    expect(() => repo.upsert({ kind: 'ip', value: '2001:DB8::1.', source: 'agent' })).toThrow(/ip address/i)
  })
})

describe('TargetRepository.upsert — automatic parentage', () => {
  it('creates the apex and parents a subdomain under it', () => {
    const sub = repo.upsert({ kind: 'subdomain', value: 'app.smartfit.com.br', source: 'sub_nmap' })

    const apex = repo.all().find((t) => t.value === 'smartfit.com.br')
    expect(apex).toBeDefined()
    expect(apex?.kind).toBe('domain')
    expect(sub.parentId).toBe(apex?.id)
  })

  it('marks an apex it invented itself so it is not mistaken for a scoped target', () => {
    repo.upsert({ kind: 'subdomain', value: 'app.smartfit.com.br', source: 'sub_nmap' })
    expect(repo.all().find((t) => t.value === 'smartfit.com.br')?.source).toBe('derived')
  })

  it('reuses an apex that already exists rather than creating a second one', () => {
    const apex = repo.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' })
    const sub = repo.upsert({ kind: 'subdomain', value: 'app.smartfit.com.br', source: 'agent' })
    expect(sub.parentId).toBe(apex.id)
    expect(repo.all().filter((t) => t.value === 'smartfit.com.br')).toHaveLength(1)
  })

  it('parents a url to the host it lives on', () => {
    const url = repo.upsert({
      kind: 'url',
      value: 'https://app.smartfit.com.br/api/locations',
      source: 'agent',
    })
    const host = repo.all().find((t) => t.value === 'app.smartfit.com.br')
    expect(url.parentId).toBe(host?.id)
  })

  it('leaves an apex at the root', () => {
    expect(repo.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' }).parentId).toBeNull()
  })

  it('does not parent a target to itself', () => {
    const apex = repo.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' })
    expect(apex.parentId).not.toBe(apex.id)
  })
})

describe('TargetRepository.upsert — scope verdicts', () => {
  it('records unknown while the engagement has no rules', () => {
    const t = repo.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' })
    expect(t.scopeStatus).toBe('unknown')
    expect(t.scopeReason).toMatch(/no scope rules/i)
  })

  it('marks an asset a rule covers as in scope', () => {
    rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'manual' })
    expect(repo.upsert({ kind: 'subdomain', value: 'app.smartfit.com.br', source: 'agent' }).scopeStatus).toBe(
      'in',
    )
  })

  it('stores an asset no rule covers, flagged rather than refused', () => {
    rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'manual' })
    const stray = repo.upsert({
      kind: 'url',
      value: 'https://qrfo53hqq5frrfmgr2o35ewfli.appsync-api.us-east-1.amazonaws.com/graphql',
      source: 'agent',
    })
    expect(stray.scopeStatus).toBe('unknown')
    expect(repo.get(stray.id)).toBeDefined()
  })

  it('marks an excluded asset out of scope', () => {
    rules.add({ effect: 'exclude', pattern: 'smartfit.io', note: 'parked', source: 'manual' })
    const out = repo.upsert({ kind: 'domain', value: 'smartfit.io', source: 'agent' })
    expect(out.scopeStatus).toBe('out')
    expect(out.scopeReason).toContain('parked')
  })

  it('gives an apex it invented the verdict its own value earns', () => {
    rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'manual' })
    repo.upsert({ kind: 'subdomain', value: 'app.smartfit.com.br', source: 'agent' })
    expect(repo.all().find((t) => t.value === 'smartfit.com.br')?.scopeStatus).toBe('in')
  })

  it('re-judges every target when the rules change', () => {
    const stray = repo.upsert({ kind: 'domain', value: 'smartfit.io', source: 'agent' })
    expect(stray.scopeStatus).toBe('unknown')

    rules.add({ effect: 'exclude', pattern: 'smartfit.io', source: 'manual' })
    const rejudged = repo.reevaluateScope()

    expect(rejudged).toBe(1)
    expect(repo.get(stray.id)?.scopeStatus).toBe('out')
  })
})

describe('ScopeRuleRepository', () => {
  it('lists the rules it stores', () => {
    rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'agent' })
    rules.add({ effect: 'exclude', pattern: 'smartfit.io', note: 'parked', source: 'manual' })

    expect(rules.all().map((r) => r.pattern)).toEqual(
      expect.arrayContaining(['*.smartfit.com.br', 'smartfit.io']),
    )
  })

  it('is idempotent on effect and pattern, so a re-run does not pile up duplicates', () => {
    const first = rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'agent' })
    const again = rules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'agent' })
    expect(again.id).toBe(first.id)
    expect(rules.all()).toHaveLength(1)
  })

  it('keeps an include and an exclude of the same pattern apart', () => {
    rules.add({ effect: 'include', pattern: 'smartfit.com', source: 'manual' })
    rules.add({ effect: 'exclude', pattern: 'smartfit.com', source: 'manual' })
    expect(rules.all()).toHaveLength(2)
  })

  it('normalises a pattern so a pasted url becomes a hostname rule', () => {
    expect(rules.add({ effect: 'include', pattern: 'https://smartfit.com', source: 'agent' }).pattern).toBe(
      'smartfit.com',
    )
  })

  it('removes a rule', () => {
    const rule = rules.add({ effect: 'include', pattern: 'smartfit.com', source: 'manual' })
    expect(rules.remove(rule.id)).toBe(true)
    expect(rules.all()).toHaveLength(0)
  })
})

describe('ScopeRuleRepository — refusing rules that cannot match', () => {
  it('refuses a vulnerability class dressed up as a rule', () => {
    expect(() => rules.add({ effect: 'exclude', pattern: 'class:dos-ecu-bus-flooding', source: 'agent' })).toThrow(
      /asset/i,
    )
  })

  it('refuses an invented namespace prefix', () => {
    expect(() =>
      rules.add({ effect: 'include', pattern: 'device:remaining-functions', source: 'agent' }),
    ).toThrow()
  })

  it('refuses a bare app store id', () => {
    expect(() => rules.add({ effect: 'include', pattern: '1519034860', source: 'agent' })).toThrow(/number/i)
  })

  it('stores nothing when it refuses', () => {
    try {
      rules.add({ effect: 'exclude', pattern: 'class:duplicate', source: 'agent' })
    } catch {
      /* expected */
    }
    expect(rules.all()).toHaveLength(0)
  })

  it('still takes every shape the matcher understands', () => {
    for (const pattern of ['smartfit.com', '*.smartfit.com.br', '10.0.0.0/8', '*/totem/*']) {
      expect(() => rules.add({ effect: 'include', pattern, source: 'manual' })).not.toThrow()
    }
    expect(rules.all()).toHaveLength(4)
  })
})
