import { describe, expect, it } from 'vitest'
import { toolManifestSchema } from './manifest.js'

const base = {
  id: 'subfinder',
  name: 'Subfinder',
  description: 'Passive subdomain enumeration',
  category: 'recon',
  accepts: ['domain'],
  command: { program: 'subfinder', args: ['-silent', '-d', '{{ target.value }}'] },
  emit: {
    parser: 'json',
    targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }],
  },
}

describe('toolManifestSchema', () => {
  it('accepts a well formed json manifest and applies defaults', () => {
    const m = toolManifestSchema.parse(base)
    expect(m.command.timeout_ms).toBe(120000)
    expect(m.emit.source).toBe('stdout')
    expect(m.emit.records).toBe('$')
    expect(m.emit.facts).toEqual([])
    expect(m.params).toEqual({})
  })

  it('rejects a bad id slug', () => {
    expect(() => toolManifestSchema.parse({ ...base, id: 'Sub Finder' })).toThrow()
  })

  it('requires a pattern when parser is regex', () => {
    expect(() =>
      toolManifestSchema.parse({ ...base, emit: { parser: 'regex', facts: [] } }),
    ).toThrow()
  })

  it('requires path and format when parser is file', () => {
    expect(() =>
      toolManifestSchema.parse({ ...base, emit: { parser: 'file', facts: [] } }),
    ).toThrow()
  })

  it('rejects an unknown emit fact kind', () => {
    expect(() =>
      toolManifestSchema.parse({
        ...base,
        emit: { parser: 'json', facts: [{ kind: 'dns', data: { a: '{{ record.a }}' } }] },
      }),
    ).toThrow()
  })
})
