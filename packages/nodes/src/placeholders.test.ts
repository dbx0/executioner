import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { escapeJsonString, escapePythonString, interpolate, resolvePath } from './placeholders.js'

describe('resolvePath', () => {
  it('walks a dotted path', () => {
    expect(resolvePath({ a: { b: 'c' } }, 'a.b')).toBe('c')
  })

  it('returns undefined for a missing path', () => {
    expect(resolvePath({ a: {} }, 'a.b.c')).toBeUndefined()
  })
})

describe('interpolate', () => {
  const ctx = { target: { value: 'example.com' }, params: { ports: '80,443' }, record: { host: 'a.example.com' } }

  it('substitutes a single placeholder token', () => {
    expect(interpolate('{{ target.value }}', ctx)).toBe('example.com')
  })

  it('substitutes multiple placeholders in one token', () => {
    expect(interpolate('{{ record.host }}:{{ params.ports }}', ctx)).toBe('a.example.com:80,443')
  })

  it('leaves a literal with no placeholders unchanged', () => {
    expect(interpolate('-silent', ctx)).toBe('-silent')
  })

  it('returns undefined when any placeholder is missing', () => {
    expect(interpolate('{{ record.missing }}', ctx)).toBeUndefined()
  })
})

describe('prototype safety', () => {
  it('resolves own properties only, never the prototype chain', () => {
    const ctx = { target: { value: 'a.com' } }
    expect(resolvePath(ctx.target, 'constructor')).toBeUndefined()
    expect(interpolate('{{ target.constructor }}', ctx)).toBeUndefined()
    expect(interpolate('{{ toString }}', ctx)).toBeUndefined()
  })
})

describe('escapePythonString', () => {
  const hostile = [
    `a";__import__('os').system('echo PWNED');"`,
    "x'''\n__import__('os').system('echo PWNED')\n'''",
    "{__import__('os').system('echo PWNED')}",
    'back\\slash and \ttab\u0000nul',
  ]

  it('passes each value through interpolate as escaped text', () => {
    expect(interpolate('"{{ v }}"', { v: 'say "hi"\n' }, escapePythonString)).toBe('"say \\"hi\\"\\n"')
  })

  const python = spawnSync('python3', ['--version']).status === 0
  it.skipIf(!python)('round-trips hostile values through every kind of Python literal without running them', () => {
    for (const value of hostile) {
      const script = [
        'import json',
        'a = "{{ v }}"',
        "b = '{{ v }}'",
        'c = """{{ v }}"""',
        'd = f"{{ v }}"',
        'print(json.dumps([a, b, c, d]))',
      ].join('\n')
      const source = interpolate(script, { v: value }, escapePythonString) as string
      const run = spawnSync('python3', ['-c', source], { encoding: 'utf8' })
      expect(run.status).toBe(0)
      // An injected echo would print PWNED on a line of its own.
      expect(run.stdout.split('\n')).not.toContain('PWNED')
      expect(JSON.parse(run.stdout)).toEqual([value, value, value, value])
    }
  })
})

describe('escapeJsonString', () => {
  const hostile = ['a","admin":true,"b":"', 'line\r\nbreak', 'back\\slash \u0000 nul', '  and </script>', '\\"}']

  it('keeps every hostile value inside the string it was placed in', () => {
    for (const value of hostile) {
      const body = interpolate('{"name":"{{ v }}","role":"user"}', { v: value }, escapeJsonString) as string
      expect(JSON.parse(body)).toEqual({ name: value, role: 'user' })
    }
  })

  it('leaves a bare number usable', () => {
    expect(JSON.parse(interpolate('{"n":{{ v }}}', { v: 42 }, escapeJsonString) as string)).toEqual({ n: 42 })
  })
})

describe('interpolate with hyphenated fields', () => {
  it('reads a field whose name has a hyphen', () => {
    expect(interpolate('{{ record.template-id }}', { record: { 'template-id': 'CVE-2021-44228' } })).toBe('CVE-2021-44228')
  })

  it('still does not read a hyphen as part of the root', () => {
    expect(interpolate('{{ re-cord.x }}', { 're-cord': { x: 'y' } })).toBe('{{ re-cord.x }}')
  })
})
