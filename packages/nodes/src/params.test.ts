import { describe, expect, it } from 'vitest'
import { toolManifestSchema } from '@exe/protocol'
import { resolveParams } from './params.js'

const manifest = toolManifestSchema.parse({
  id: 'nmap',
  name: 'Nmap',
  description: 'Port scan',
  category: 'scan',
  accepts: ['ip'],
  params: {
    ports: { type: 'string', default: '1-1000' },
    mode: { type: 'enum', values: ['fast', 'full'], default: 'fast' },
    top: { type: 'number' },
  },
  command: { program: 'nmap', args: ['{{ target.value }}'] },
  emit: { parser: 'json' },
})

describe('resolveParams', () => {
  it('fills declared defaults', () => {
    const params = resolveParams(manifest, { top: 100 })
    expect(params).toEqual({ ports: '1-1000', mode: 'fast', top: 100 })
  })

  it('overrides a default with a provided value', () => {
    const params = resolveParams(manifest, { ports: '80,443', top: 1 })
    expect(params.ports).toBe('80,443')
  })

  it('rejects a value of the wrong type', () => {
    expect(() => resolveParams(manifest, { ports: 123, top: 1 })).toThrow(/ports/)
  })

  it('rejects an enum value outside the allowed set', () => {
    expect(() => resolveParams(manifest, { mode: 'stealth', top: 1 })).toThrow(/mode/)
  })

  it('rejects a missing required param that has no default', () => {
    expect(() => resolveParams(manifest, {})).toThrow(/top/)
  })
})
