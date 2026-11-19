import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { connect } from 'node:tls'

/** A served certificate, reduced to what an inventory or an expiry check reads. */
export interface CertificateInfo {
  subject_cn: string
  issuer: string
  /** ISO 8601, so two certificates compare as strings whichever tool saw them. */
  not_before: string
  not_after: string
  /** Subject alternative names, comma separated. */
  sans: string
  serial: string
  fingerprint_sha256: string
}

/** Fetches the certificate `host:port` serves, or throws with a reason the node
 *  can surface. Injectable so tests drive the node without a TLS server. */
export type TlsProbe = (host: string, port: number, timeoutMs: number) => Promise<CertificateInfo>

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'] as const
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

/** DNS as the nodes need it. "No such record" is an empty answer, never a throw:
 *  a name without an MX is a fact about the name, not a failed lookup. */
export interface DnsLookup {
  resolve(name: string, type: DnsRecordType): Promise<string[]>
  reverse(ip: string): Promise<string[]>
}

/** The fields of node's `PeerCertificate` this module reads. */
export interface PeerCertificateLike {
  subject?: { CN?: string | string[] }
  issuer?: { CN?: string | string[]; O?: string | string[] }
  subjectaltname?: string
  valid_from?: string
  valid_to?: string
  serialNumber?: string
  fingerprint256?: string
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))

const toIso = (text: string | undefined): string | null => {
  if (text === undefined) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Reduce a peer certificate to a `CertificateInfo`. Returns null for the empty
 * object node hands back when the peer presented no certificate.
 */
export function certificateFromPeer(peer: PeerCertificateLike): CertificateInfo | null {
  const notBefore = toIso(peer.valid_from)
  const notAfter = toIso(peer.valid_to)
  if (notBefore === null || notAfter === null) return null
  // "DNS:example.com, IP Address:2001:db8::1": the label ends at the first colon.
  const sans = (peer.subjectaltname ?? '')
    .split(', ')
    .map((entry) => entry.slice(entry.indexOf(':') + 1).trim())
    .filter((name) => name !== '')
  return {
    subject_cn: first(peer.subject?.CN),
    issuer: [first(peer.issuer?.O), first(peer.issuer?.CN)].filter((part) => part !== '').join(' '),
    not_before: notBefore,
    not_after: notAfter,
    sans: sans.join(','),
    serial: peer.serialNumber ?? '',
    fingerprint_sha256: peer.fingerprint256 ?? '',
  }
}

/**
 * The real probe: one handshake, certificate read, socket closed. Verification
 * is off on purpose: an expired or self-signed certificate is exactly what the
 * caller wants to hear about, and nothing is sent over the connection.
 */
export const tlsProbe: TlsProbe = (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      // SNI must be a name; an address literal there is a protocol error.
      ...(isIP(host) === 0 ? { servername: host } : {}),
    })
    socket.once('secureConnect', () => {
      const info = certificateFromPeer(socket.getPeerCertificate())
      socket.end()
      if (info === null) reject(new Error('the server presented no certificate'))
      else resolve(info)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`TLS handshake timed out after ${String(timeoutMs)}ms`))
    })
    socket.once('error', reject)
  })

/** Resolver codes that mean "this name has no such record", not "the lookup broke". */
const NO_ANSWER = new Set(['ENODATA', 'ENOTFOUND'])

async function answered(lookup: Promise<string[]>): Promise<string[]> {
  try {
    return await lookup
  } catch (e) {
    if (NO_ANSWER.has(String((e as { code?: unknown }).code))) return []
    throw e
  }
}

/** DNS through the system's configured resolvers. */
export const systemDns: DnsLookup = {
  resolve(name, type) {
    switch (type) {
      case 'A':
        return answered(dns.resolve4(name))
      case 'AAAA':
        return answered(dns.resolve6(name))
      case 'CNAME':
        return answered(dns.resolveCname(name))
      case 'NS':
        return answered(dns.resolveNs(name))
      case 'MX':
        return answered(
          dns.resolveMx(name).then((records) => [...records].sort((a, b) => a.priority - b.priority).map((r) => r.exchange)),
        )
      case 'TXT':
        // One TXT record arrives as its 255-byte chunks; joined, it is the value.
        return answered(dns.resolveTxt(name).then((records) => records.map((chunks) => chunks.join(''))))
    }
  },
  reverse: (ip) => answered(dns.reverse(ip)),
}

/** Suffixes teams actually put on bucket names, tried after the bare keyword. */
const BUCKET_SUFFIXES = [
  'dev',
  'staging',
  'stage',
  'prod',
  'production',
  'test',
  'qa',
  'backup',
  'backups',
  'assets',
  'static',
  'media',
  'uploads',
  'files',
  'data',
  'logs',
  'public',
  'private',
  'internal',
  'cdn',
  'web',
  'app',
]

/** Lowercase, and only what every provider allows in a bucket name. */
const bucketSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * The bucket names worth probing for a keyword: the keyword itself, then
 * `<keyword>-<suffix>` for the built-in suffixes and for each extra word (one
 * per line). De-duplicated, in that order.
 */
export function bucketCandidates(keyword: string, extraWords = ''): string[] {
  const base = bucketSlug(keyword)
  if (base === '') return []
  const words = [...BUCKET_SUFFIXES, ...extraWords.split('\n').map(bucketSlug).filter((w) => w !== '')]
  return [...new Set([base, ...words.map((word) => `${base}-${word}`)])]
}
