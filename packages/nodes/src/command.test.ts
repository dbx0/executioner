import { describe, expect, it } from 'vitest'
import { toolManifestSchema } from '@exe/protocol'
import { buildArgv } from './command.js'

const manifest = toolManifestSchema.parse({
  id: 'nmap',
  name: 'Nmap',
  description: 'Port scan',
  category: 'scan',
  accepts: ['ip', 'domain'],
  command: { program: 'nmap', args: ['-p', '{{ params.ports }}', '{{ target.value }}'] },
  emit: { parser: 'json' },
})

describe('buildArgv', () => {
  it('resolves placeholders into a program and argv array', () => {
    const argv = buildArgv(manifest, { target: { value: 'example.com' }, params: { ports: '1-1000' } })
    expect(argv.program).toBe('nmap')
    expect(argv.args).toEqual(['-p', '1-1000', 'example.com'])
  })

  it('keeps a malicious target value as one argv token (no shell, no split)', () => {
    const argv = buildArgv(manifest, {
      target: { value: '; rm -rf / #' },
      params: { ports: '80' },
    })
    expect(argv.args).toEqual(['-p', '80', '; rm -rf / #'])
    expect(argv.args).toHaveLength(3)
  })

  it('throws when a required placeholder is missing', () => {
    expect(() => buildArgv(manifest, { target: { value: 'example.com' }, params: {} })).toThrow(
      /ports/,
    )
  })
})
