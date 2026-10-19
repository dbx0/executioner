export type TargetKind = 'domain' | 'subdomain' | 'ip' | 'cidr' | 'url'

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/
const IPV4_CIDR = /^(\d{1,3})(\.\d{1,3}){3}\/\d{1,2}$/
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*)(\.[a-z0-9](-?[a-z0-9])*)+$/i

function isIpv4(v: string): boolean {
  return IPV4.test(v) && v.split('.').every((o) => Number(o) <= 255)
}

/**
 * Guess a target's kind from the raw value: URL (has a scheme), CIDR (IPv4/IPv6
 * with a /prefix), IP (IPv4 or IPv6), else a hostname — subdomain when it has 3+
 * labels (api.example.com), domain when it has 2 (example.com). Heuristic: the
 * user can still override in the UI (e.g. multi-part TLDs like example.co.uk).
 */
export function detectTargetKind(raw: string): TargetKind {
  const v = raw.trim()
  if (v === '') return 'domain'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return 'url'
  if (IPV4_CIDR.test(v) || (v.includes(':') && /\/\d{1,3}$/.test(v))) return 'cidr'
  if (isIpv4(v)) return 'ip'
  if (v.includes(':') && /^[0-9a-f:]+$/i.test(v)) return 'ip' // IPv6
  if (HOSTNAME.test(v)) return v.replace(/\.$/, '').split('.').length >= 3 ? 'subdomain' : 'domain'
  return 'domain'
}
