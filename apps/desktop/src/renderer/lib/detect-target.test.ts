import { describe, expect, it } from 'vitest'
import { detectTargetKind } from './detect-target.js'

describe('detectTargetKind', () => {
  it('detects each kind from the value', () => {
    expect(detectTargetKind('example.com')).toBe('domain')
    expect(detectTargetKind('api.example.com')).toBe('subdomain')
    expect(detectTargetKind('deep.api.example.com')).toBe('subdomain')
    expect(detectTargetKind('10.0.0.1')).toBe('ip')
    expect(detectTargetKind('10.0.0.0/24')).toBe('cidr')
    expect(detectTargetKind('https://example.com/app')).toBe('url')
    expect(detectTargetKind('http://10.0.0.1:8080')).toBe('url')
  })
  it('handles ipv6 and trailing dots, defaults to domain', () => {
    expect(detectTargetKind('2001:db8::1')).toBe('ip')
    expect(detectTargetKind('2001:db8::/32')).toBe('cidr')
    expect(detectTargetKind('example.com.')).toBe('domain')
    expect(detectTargetKind('  ')).toBe('domain')
  })
})
