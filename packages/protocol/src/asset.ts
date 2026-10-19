import { isIP, isIPv4 } from 'node:net'
import { getDomain } from 'tldts'
import { TargetKind, type TargetKind as TargetKindValue } from './target.js'

/**
 * An asset in canonical form: the single spelling used as its identity.
 *
 * `kind` is DERIVED, not taken from the caller. Tools and agents guess badly —
 * the SMARTFIT engagement ended up with nine hosts filed as both `domain` and
 * `subdomain`, and its apex `smartfit.com.br` filed as a subdomain — so the
 * value decides and the caller's kind is only a hint about how to read it.
 */
export interface CanonicalAsset {
  kind: TargetKindValue
  /** Canonical spelling. Two inputs sharing this are the same asset. */
  value: string
  /** Registrable domain, or null when the asset has no hostname (ip, cidr). */
  apex: string | null
  /** Hostname this asset lives on: the host itself, or a url's host. */
  host: string | null
}

export interface AssetRejection {
  error: string
}

export function isCanonicalAsset(result: CanonicalAsset | AssetRejection): result is CanonicalAsset {
  return (result as CanonicalAsset).value !== undefined
}

const HOSTNAME_KINDS = new Set<string>([TargetKind.Domain, TargetKind.Subdomain])
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** Expands an IPv4 or IPv6 address to its raw bytes, or null when malformed. */
function addressToBytes(address: string): Uint8Array | null {
  if (isIPv4(address)) {
    return Uint8Array.from(address.split('.').map((octet) => Number(octet)))
  }
  if (isIP(address) !== 6) return null

  // Split around the '::' elision, expanding any trailing dotted quad first.
  const quad = /:(\d+\.\d+\.\d+\.\d+)$/.exec(address)
  let text = address
  if (quad !== null && quad[1] !== undefined) {
    const octets = quad[1].split('.').map((o) => Number(o))
    const high = ((octets[0] as number) << 8) | (octets[1] as number)
    const low = ((octets[2] as number) << 8) | (octets[3] as number)
    text = `${address.slice(0, quad.index)}:${high.toString(16)}:${low.toString(16)}`
  }

  const [head, tail] = text.split('::') as [string, string | undefined]
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':')
  const missing = 8 - headGroups.length - tailGroups.length
  if (tail === undefined && missing !== 0) return null
  if (missing < 0) return null

  const groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups]
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i += 1) {
    const group = Number.parseInt(groups[i] as string, 16)
    if (Number.isNaN(group)) return null
    bytes[i * 2] = group >> 8
    bytes[i * 2 + 1] = group & 0xff
  }
  return bytes
}

/** Renders bytes back to the shortest legal spelling of the address. */
function bytesToAddress(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i] as number) << 8) | (bytes[i + 1] as number)).toString(16))
  }
  // The WHATWG URL parser already implements IPv6 '::' compression correctly;
  // reusing it beats re-deriving the longest-run-of-zeroes rule here.
  return new URL(`http://[${groups.join(':')}]`).hostname.slice(1, -1)
}

function canonicaliseIp(raw: string): CanonicalAsset | AssetRejection {
  const bytes = addressToBytes(raw.trim())
  if (bytes === null) return { error: `"${raw.trim()}" is not a valid ip address` }
  return { kind: TargetKind.Ip, value: bytesToAddress(bytes), apex: null, host: null }
}

function canonicaliseCidr(raw: string): CanonicalAsset | AssetRejection {
  const trimmed = raw.trim()
  const slash = trimmed.lastIndexOf('/')
  if (slash === -1) return { error: `"${trimmed}" is not a valid cidr: no prefix length` }

  const address = trimmed.slice(0, slash)
  const bytes = addressToBytes(address)
  if (bytes === null) return { error: `"${address}" is not a valid ip address` }

  const prefix = Number(trimmed.slice(slash + 1))
  const width = bytes.length * 8
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) {
    return { error: `"${trimmed}" has an out-of-range prefix length (expected 0-${width})` }
  }

  // Mask the host bits off so 10.0.0.5/24 and 10.0.0.0/24 are one network.
  const masked = new Uint8Array(bytes)
  for (let bit = prefix; bit < width; bit += 1) {
    const byte = bit >> 3
    masked[byte] = (masked[byte] as number) & ~(0x80 >> (bit & 7))
  }

  return {
    kind: TargetKind.Cidr,
    value: `${bytesToAddress(masked)}/${prefix}`,
    apex: null,
    host: null,
  }
}

/** Lowercases, punycodes and strips scheme/port/trailing dot from a hostname. */
function canonicaliseHostname(raw: string): { host: string } | AssetRejection {
  let candidate = raw.trim().replace(SCHEME, '')
  while (candidate.endsWith('.')) candidate = candidate.slice(0, -1)

  if (candidate.length === 0) return { error: 'hostname is empty' }
  if (candidate.includes('*')) {
    return { error: `"${raw.trim()}" is a wildcard: add it as a scope rule, not an asset` }
  }
  if (candidate.includes('/')) return { error: 'a hostname must not contain a path' }

  let host: string
  try {
    host = new URL(`http://${candidate}`).hostname
  } catch {
    return { error: `"${candidate}" is not a valid hostname` }
  }
  if (host.length === 0) return { error: 'hostname is empty' }
  // The URL parser keeps characters no DNS name can carry (quotes, `;`, `$`,
  // backticks) and a label that starts with '-'. A target value is handed to
  // tools as an argument, so either would let a stored "host" pose as a flag
  // (`--script=...`) or smuggle shell syntax into a script that pastes it.
  if (!host.startsWith('[') && !HOST_LABELS.test(host)) {
    return { error: `"${candidate}" is not a valid hostname` }
  }
  return { host }
}

/** Letters, digits, '_' and '-' in dot-separated labels, none starting with '-'. */
const HOST_LABELS = /^[a-z0-9_][a-z0-9_-]*(\.[a-z0-9_][a-z0-9_-]*)*$/

function hostnameAsset(host: string): CanonicalAsset {
  // A bracketed literal is how the URL parser hands back an IPv6 host.
  const literal = host.startsWith('[') ? host.slice(1, -1) : host
  if (isIP(literal) !== 0) {
    return { kind: TargetKind.Ip, value: bytesToAddress(addressToBytes(literal) as Uint8Array), apex: null, host: null }
  }

  // A name the public suffix list does not recognise (an internal name, a new
  // TLD) is its own apex rather than a subdomain of nothing.
  const apex = getDomain(host) ?? host
  return {
    kind: apex === host ? TargetKind.Domain : TargetKind.Subdomain,
    value: host,
    apex,
    host,
  }
}

function canonicaliseUrl(raw: string): CanonicalAsset | AssetRejection {
  const trimmed = raw.trim()
  if (trimmed.includes('*')) {
    return { error: `"${trimmed}" is a wildcard: add it as a scope rule, not an asset` }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { error: `"${trimmed}" is not a valid url` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `"${trimmed}" must use http or https` }
  }

  // The URL parser has already lowercased the scheme and host, punycoded the
  // host and dropped a default port. Only the fragment has to go by hand: it
  // never reaches the server, so two urls differing only there are one asset.
  url.hash = ''
  const owner = hostnameAsset(url.hostname)
  return {
    kind: TargetKind.Url,
    value: url.toString(),
    apex: owner.apex,
    host: owner.host,
  }
}

/**
 * Folds an asset to the single spelling used as its identity, deriving its kind
 * and the apex it belongs under, or explains why it cannot be stored.
 *
 * Every write to the target tree goes through this. Rejection means the input is
 * malformed (a wildcard, a bad address, a url with no scheme) — being outside
 * the engagement's scope is a separate judgement made against the scope rules,
 * and never rejects an asset here.
 */
export function canonicaliseAsset(input: { kind: string; value: string }): CanonicalAsset | AssetRejection {
  if (input.kind === TargetKind.Ip) return canonicaliseIp(input.value)
  if (input.kind === TargetKind.Cidr) return canonicaliseCidr(input.value)
  if (input.kind === TargetKind.Url) return canonicaliseUrl(input.value)

  if (!HOSTNAME_KINDS.has(input.kind)) return { error: `unknown target kind "${input.kind}"` }

  const host = canonicaliseHostname(input.value)
  if ('error' in host) return host
  return hostnameAsset(host.host)
}

/**
 * True when `inner` (an ip or a cidr) falls entirely inside the `outer` cidr.
 * Address families never contain one another, so a v4/v6 pair is always false.
 */
export function cidrContains(outer: string, inner: string): boolean {
  const slash = outer.lastIndexOf('/')
  if (slash === -1) return false
  const outerBytes = addressToBytes(outer.slice(0, slash))
  const outerPrefix = Number(outer.slice(slash + 1))
  if (outerBytes === null || !Number.isInteger(outerPrefix)) return false

  const innerSlash = inner.lastIndexOf('/')
  const innerBytes = addressToBytes(innerSlash === -1 ? inner : inner.slice(0, innerSlash))
  const innerPrefix = innerSlash === -1 ? null : Number(inner.slice(innerSlash + 1))
  if (innerBytes === null) return false
  if (outerBytes.length !== innerBytes.length) return false

  // A network wider than the rule's is not contained by it, however much of it
  // overlaps: 10.0.0.0/8 is not inside 10.1.0.0/16.
  if (innerPrefix !== null && innerPrefix < outerPrefix) return false

  for (let bit = 0; bit < outerPrefix; bit += 1) {
    const byte = bit >> 3
    const mask = 0x80 >> (bit & 7)
    if (((outerBytes[byte] as number) & mask) !== ((innerBytes[byte] as number) & mask)) return false
  }
  return true
}
