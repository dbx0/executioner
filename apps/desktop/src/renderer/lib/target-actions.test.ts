import { describe, expect, it } from 'vitest'
import type { TargetNode } from '../api/targets.js'
import type { WorkflowSummary } from '../api/workflows.js'
import { countDescendants, scopePatternFor, targetActionModel, LOCAL_BACKEND } from './target-actions.js'

const node = (over: Partial<TargetNode> = {}): TargetNode => ({
  id: 't1',
  kind: 'domain',
  value: 'smartfit.com.br',
  apex: 'smartfit.com.br',
  parentId: null,
  source: 'manual',
  scopeStatus: 'unknown',
  scopeReason: 'no scope rules defined yet',
  children: [],
  ...over,
})

const workflows: WorkflowSummary[] = [
  { id: 'wf1', name: 'Subdomain sweep', updated_at: '2026-09-01T00:00:00.000Z' },
  { id: 'wf2', name: 'Port scan', updated_at: '2026-09-01T00:00:00.000Z' },
]

const model = (n = node(), wf = workflows, backends = [LOCAL_BACKEND]) => targetActionModel(n, wf, backends)

describe('scopePatternFor', () => {
  it('covers everything under an apex with a wildcard', () => {
    expect(scopePatternFor(node({ kind: 'domain', value: 'smartfit.com.br' }))).toBe('*.smartfit.com.br')
  })

  it('names a subdomain exactly, so it does not widen the boundary', () => {
    expect(scopePatternFor(node({ kind: 'subdomain', value: 'app.smartfit.com.br' }))).toBe('app.smartfit.com.br')
  })

  it('names a url exactly', () => {
    expect(scopePatternFor(node({ kind: 'url', value: 'https://app.smartfit.com.br/api' }))).toBe(
      'https://app.smartfit.com.br/api',
    )
  })

  it('names an ip exactly', () => {
    expect(scopePatternFor(node({ kind: 'ip', value: '54.234.85.144' }))).toBe('54.234.85.144')
  })
})

describe('countDescendants', () => {
  it('counts nothing under a leaf', () => {
    expect(countDescendants(node())).toBe(0)
  })

  it('counts every level, not just the immediate children', () => {
    expect(countDescendants(node({ children: [node({ children: [node()] }), node()] }))).toBe(3)
  })
})

describe('targetActionModel — scope', () => {
  it('excludes an apex the same way it includes one: everything under it', () => {
    // A parked apex whose wildcard resolves every subdomain is the case that
    // matters; excluding only the apex would leave the phantoms unjudged.
    const m = model()
    expect(m.includePattern).toBe('*.smartfit.com.br')
    expect(m.excludePattern).toBe('*.smartfit.com.br')
  })

  it('excludes a subdomain exactly, reaching no further than the row clicked', () => {
    const m = model(node({ kind: 'subdomain', value: 'app.smartfit.com.br' }))
    expect(m.excludePattern).toBe('app.smartfit.com.br')
  })

  it('excludes a url exactly', () => {
    const m = model(node({ kind: 'url', value: 'https://app.smartfit.com.br/api' }))
    expect(m.excludePattern).toBe('https://app.smartfit.com.br/api')
  })

  it('excludes an ip exactly, since a wildcard would mean nothing there', () => {
    expect(model(node({ kind: 'ip', value: '54.234.85.144' })).excludePattern).toBe('54.234.85.144')
  })
})

describe('targetActionModel — delete', () => {
  it('asks nothing before deleting a leaf', () => {
    expect(model().needsDeleteConfirmation).toBe(false)
  })

  it('asks first when descendants would go too, and says how many', () => {
    const m = model(node({ children: [node(), node()] }))
    expect(m.needsDeleteConfirmation).toBe(true)
    expect(m.descendants).toBe(2)
  })
})

describe('targetActionModel — where a run goes', () => {
  it('offers no choice when this machine is the only place', () => {
    const m = model()
    expect(m.singleDestination).toEqual(LOCAL_BACKEND)
    expect(m.workflows.every((w) => w.destinations === null)).toBe(true)
  })

  it('treats an empty backend list as this machine rather than nothing', () => {
    expect(model(node(), workflows, []).singleDestination).toEqual(LOCAL_BACKEND)
  })

  it('offers each destination under every workflow once there is a choice', () => {
    const m = model(node(), workflows, [LOCAL_BACKEND, { id: 'b1', name: 'kali-vps' }])

    expect(m.singleDestination).toBeNull()
    expect(m.workflows[0]?.destinations).toEqual([
      { backendId: 'local', label: 'Run on this machine' },
      { backendId: 'b1', label: 'Run on kali-vps' },
    ])
  })

  it('gives every workflow the same destinations', () => {
    const m = model(node(), workflows, [LOCAL_BACKEND, { id: 'b1', name: 'kali-vps' }])
    expect(m.workflows.map((w) => w.destinations?.length)).toEqual([2, 2])
  })

  it('carries the id and name of each workflow through for the menu to render', () => {
    expect(model().workflows).toEqual([
      { workflowId: 'wf1', name: 'Subdomain sweep', destinations: null },
      { workflowId: 'wf2', name: 'Port scan', destinations: null },
    ])
  })

  it('offers nothing to run when no workflows are saved', () => {
    expect(model(node(), []).workflows).toEqual([])
  })
})
