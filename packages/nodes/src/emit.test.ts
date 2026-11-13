import { describe, expect, it } from 'vitest'
import { emitSchema } from '@exe/protocol'
import { applyEmit } from './emit.js'

const ctx = {
  target: { id: 'target-1', kind: 'domain' as const, value: 'example.com' },
  params: {},
  nodeId: 'subfinder',
  executionId: 'exec-1',
}

describe('applyEmit', () => {
  it('maps records into target upserts linked to the input', () => {
    const emit = emitSchema.parse({
      parser: 'json',
      targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }],
    })
    const records = [{ host: 'a.example.com' }, { host: 'b.example.com' }]
    const { targets, facts } = applyEmit(records, emit, ctx)
    expect(facts).toEqual([])
    expect(targets).toEqual([
      { kind: 'subdomain', value: 'a.example.com', source: 'subfinder', parentId: 'target-1' },
      { kind: 'subdomain', value: 'b.example.com', source: 'subfinder', parentId: 'target-1' },
    ])
  })

  it('maps records into facts attached to the input target', () => {
    const emit = emitSchema.parse({
      parser: 'regex',
      pattern: 'x',
      facts: [{ kind: 'port', data: { port: '{{ record.port }}', service: '{{ record.service }}' } }],
    })
    const { facts } = applyEmit([{ port: '443', service: 'https' }], emit, ctx)
    expect(facts).toEqual([
      {
        targetId: 'target-1',
        kind: 'port',
        executionId: 'exec-1',
        nodeId: 'subfinder',
        data: { port: '443', service: 'https' },
      },
    ])
  })

  it('skips a rule whose placeholder is missing rather than erroring', () => {
    const emit = emitSchema.parse({
      parser: 'json',
      targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }],
    })
    const { targets } = applyEmit([{ other: 'x' }], emit, ctx)
    expect(targets).toEqual([])
  })

  it('uses a null parent when parent is none', () => {
    const emit = emitSchema.parse({
      parser: 'json',
      targets: [{ kind: 'ip', value: '{{ record.ip }}', parent: 'none' }],
    })
    const { targets } = applyEmit([{ ip: '10.0.0.1' }], emit, ctx)
    expect(targets[0]?.parentId).toBeNull()
  })

  it('drops a fact when a field named in skip_if_empty resolves to nothing', () => {
    // A tool reports "asked, and there is none" as an empty value (dnsx gives a
    // null MX as [""]). That is not a record worth keeping.
    const emit = emitSchema.parse({
      parser: 'json',
      facts: [{ kind: 'dns_record', data: { type: 'MX', value: '{{ record.mx }}' }, skip_if_empty: ['value'] }],
    })
    const { facts } = applyEmit([{ mx: [''] }, { mx: ['mail.example.com'] }], emit, ctx)
    expect(facts.map((f) => f.data)).toEqual([{ type: 'MX', value: 'mail.example.com' }])
  })

  it('keeps an empty field on a rule that does not ask for it to be skipped', () => {
    const emit = emitSchema.parse({
      parser: 'json',
      facts: [{ kind: 'http_service', data: { url: '{{ record.url }}', title: '{{ record.title }}' } }],
    })
    const { facts } = applyEmit([{ url: 'https://example.com', title: '' }], emit, ctx)
    expect(facts.map((f) => f.data)).toEqual([{ url: 'https://example.com', title: '' }])
  })
})
