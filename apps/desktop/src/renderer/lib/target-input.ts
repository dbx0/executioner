/**
 * Renderer-side mirror of the engine's scope normalization, for the Manual tab's
 * one-by-one target entry. Applies the same rules the engine enforces so the UI
 * preview matches what lands in the DB: a URL is reduced to its host, a wildcard
 * (`*.example.com`) collapses to its parent domain, two-label hosts are domains
 * and deeper ones subdomains, bare IPv4 is `ip`, an IPv4/prefix is `cidr`.
 */
export type TargetKind = 'domain' | 'subdomain' | 'ip' | 'cidr'

export interface NormalizedTarget {
  kind: TargetKind
  value: string
}

const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'co.in', 'co.za',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.ar', 'com.tr',
  'com.cn', 'com.sg', 'com.hk', 'com.tw',
])

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const CIDR = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

function extractHost(raw: string): string {
  let s = raw.trim()
  if (s === '') return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  s = s.replace(/^[^@/]*@/, '')
  s = s.split('/')[0] ?? ''
  s = s.split('?')[0] ?? ''
  s = s.split('#')[0] ?? ''
  s = s.replace(/:\d+$/, '')
  return s.trim()
}

function isApex(host: string): boolean {
  const labels = host.split('.')
  if (labels.length <= 2) return true
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.length <= 3
  return false
}

export function normalizeManualTarget(raw: string): NormalizedTarget | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null

  if (CIDR.test(trimmed)) return { kind: 'cidr', value: trimmed }
  if (IPV4.test(trimmed)) return { kind: 'ip', value: trimmed }

  let host = extractHost(trimmed)
  if (host === '') return null
  if (host.startsWith('*.')) host = host.slice(2)
  const value = host.toLowerCase().replace(/\.$/, '')
  if (!HOSTNAME.test(value)) return null

  return { kind: isApex(value) ? 'domain' : 'subdomain', value }
}
