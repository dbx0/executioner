import { describe, expect, it } from 'vitest'
import { normalizeManualTarget } from './target-input.js'

describe('normalizeManualTarget', () => {
  it('classifies apex vs subdomain', () => {
    expect(normalizeManualTarget('example.com')).toEqual({ kind: 'domain', value: 'example.com' })
    expect(normalizeManualTarget('api.example.com')).toEqual({ kind: 'subdomain', value: 'api.example.com' })
  })

  it('collapses a wildcard to its parent', () => {
    expect(normalizeManualTarget('*.example.com')).toEqual({ kind: 'domain', value: 'example.com' })
  })

  it('strips URL scheme/path/port and lowercases', () => {
    expect(normalizeManualTarget('HTTPS://API.Example.com:8443/x')).toEqual({
      kind: 'subdomain',
      value: 'api.example.com',
    })
  })

  it('handles multi-part public suffixes', () => {
    expect(normalizeManualTarget('example.co.uk')).toEqual({ kind: 'domain', value: 'example.co.uk' })
    expect(normalizeManualTarget('api.example.co.uk')).toEqual({ kind: 'subdomain', value: 'api.example.co.uk' })
  })

  it('classifies ip and cidr', () => {
    expect(normalizeManualTarget('10.0.0.1')).toEqual({ kind: 'ip', value: '10.0.0.1' })
    expect(normalizeManualTarget('10.0.0.0/24')).toEqual({ kind: 'cidr', value: '10.0.0.0/24' })
  })

  it('rejects non-hosts', () => {
    expect(normalizeManualTarget('')).toBeNull()
    expect(normalizeManualTarget('not a host')).toBeNull()
    expect(normalizeManualTarget('localhost')).toBeNull()
  })
})
