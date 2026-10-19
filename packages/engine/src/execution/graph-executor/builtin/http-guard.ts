import { lookup as dnsLookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'
import { networkInterfaces } from 'node:os'

/** One address a hostname resolves to, as `dns.lookup` reports it. */
export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** Resolves a hostname to every address it has. Injected in tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export const systemResolver: Resolver = async (hostname) => {
  const found = await dnsLookup(hostname, { all: true, verbatim: true })
  return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))
}

/** A request the http_request node refuses to send, with a reason fit to show the user. */
export class BlockedRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedRequestError'
  }
}

/** The hint every internal-address refusal ends with, naming the opt-in. */
export const ALLOW_INTERNAL_HINT =
  'To reach an internal address on purpose, turn on "Allow internal addresses" in this node\'s settings (allow_internal).'

type Range = { bytes: number[]; prefix: number; label: string }

const v4 = (cidr: string, label: string): Range => {
  const [addr, prefix] = cidr.split('/') as [string, string]
  return { bytes: addr.split('.').map(Number), prefix: Number(prefix), label }
}

/**
 * IPv4 ranges that never belong to a target on the open internet. 169.254.0.0/16
 * holds the cloud metadata services, and 192.0.0.0/24 holds Oracle's.
 */
const V4_RANGES: Range[] = [
  v4('0.0.0.0/8', 'unspecified'),
  v4('127.0.0.0/8', 'loopback'),
  v4('10.0.0.0/8', 'private (RFC 1918)'),
  v4('172.16.0.0/12', 'private (RFC 1918)'),
  v4('192.168.0.0/16', 'private (RFC 1918)'),
  v4('100.64.0.0/10', 'carrier-grade NAT'),
  v4('169.254.0.0/16', 'link-local (cloud metadata lives here)'),
  v4('192.0.0.0/24', 'reserved'),
  v4('224.0.0.0/4', 'multicast'),
  v4('240.0.0.0/4', 'reserved'),
]

function inRange(bytes: Uint8Array | number[], range: Range): boolean {
  for (let bit = 0; bit < range.prefix; bit += 1) {
    const mask = 0x80 >> (bit & 7)
    if (((bytes[bit >> 3] as number) & mask) !== ((range.bytes[bit >> 3] as number) & mask)) return false
  }
  return true
}

/** The 16 bytes of an IPv6 address (zone id ignored), or null when it is not one. */
export function ipv6Bytes(text: string): Uint8Array | null {
  let addr = text.split('%')[0] as string
  if (!isIPv6(addr)) return null
  // Fold a trailing dotted quad (::ffff:127.0.0.1) into two hex groups.
  const tail = addr.slice(addr.lastIndexOf(':') + 1)
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number]
    addr = `${addr.slice(0, addr.lastIndexOf(':') + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, rest] = addr.includes('::') ? (addr.split('::') as [string, string]) : [addr, undefined]
  const headGroups = head === '' ? [] : head.split(':')
  const restGroups = rest === undefined || rest === '' ? [] : rest.split(':')
  const zeros = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length
  const groups = [...headGroups, ...Array<string>(zeros).fill('0'), ...restGroups]
  const bytes = new Uint8Array(16)
  groups.forEach((g, i) => {
    const n = parseInt(g, 16)
    bytes[i * 2] = n >> 8
    bytes[i * 2 + 1] = n & 0xff
  })
  return bytes
}

/**
 * The IPv4 address an IPv6 one carries, when it is one of the forms that reach
 * an IPv4 host: IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d),
 * NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
 */
function embeddedIPv4(bytes: Uint8Array): string | null {
  const quad = (at: number): string => Array.from(bytes.slice(at, at + 4)).join('.')
  const zeroUntil = (end: number): boolean => bytes.slice(0, end).every((b) => b === 0)
  if (zeroUntil(10) && bytes[10] === 0xff && bytes[11] === 0xff) return quad(12)
  if (zeroUntil(12) && !(bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && (bytes[15] as number) <= 1)) {
    return quad(12)
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)) {
    return quad(12)
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return quad(2)
  return null
}

/**
 * Names the internal class an address belongs to, or null for an ordinary
 * public address. An IPv6 address carrying an IPv4 one is judged by the IPv4
 * address, so ::ffff:127.0.0.1 is loopback like 127.0.0.1 is.
 */
export function internalAddressClass(address: string): string | null {
  if (isIPv4(address)) {
    const bytes = address.split('.').map(Number)
    return V4_RANGES.find((r) => inRange(bytes, r))?.label ?? null
  }
  const bytes = ipv6Bytes(address)
  if (bytes === null) return 'unparseable'
  if (bytes.every((b) => b === 0)) return 'unspecified'
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return 'loopback'
  const inner = embeddedIPv4(bytes)
  if (inner !== null) {
    const cls = internalAddressClass(inner)
    return cls === null ? null : `IPv4-embedded ${cls}`
  }
  const b0 = bytes[0] as number
  const b1 = bytes[1] as number
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return 'link-local'
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return 'site-local'
  if ((b0 & 0xfe) === 0xfc) return 'private (unique local, cloud metadata lives here too)'
  if (b0 === 0xff) return 'multicast'
  return null
}

/** The IPv4 form of an address when it carries one, else the address itself. */
function plainAddress(address: string): string {
  if (isIPv4(address)) return address
  const bytes = ipv6Bytes(address)
  return (bytes !== null && embeddedIPv4(bytes)) || (address.split('%')[0] as string).toLowerCase()
}

/**
 * True when connecting to this address reaches this machine: loopback, the
 * unspecified address (which Linux routes to loopback), or one of its own
 * interface addresses.
 */
export function isOwnAddress(address: string): boolean {
  const plain = plainAddress(address)
  const cls = internalAddressClass(plain)
  if (cls !== null && (cls.endsWith('loopback') || cls.endsWith('unspecified'))) return true
  const local = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .map((i) => plainAddress(i.address))
  return local.includes(plain)
}

export interface GuardOptions {
  /** The node's opt-in: internal addresses pass, the engine's own port never does. */
  allowInternal: boolean
  /** The port the engine's API listens on, refused on this machine whatever the opt-in. */
  enginePort?: number | undefined
  resolve: Resolver
}

/** The port a url connects to, with the scheme's default filled in. */
export function urlPort(url: URL): number {
  if (url.port !== '') return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/** A url's hostname without the brackets the URL parser puts around IPv6. */
export function bareHostname(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
}

/**
 * Resolves a url's host and vets every address it has, returning the one to
 * connect to. The caller must connect to exactly that address: resolving the
 * name again would let a DNS answer that changed in between (rebinding) steer
 * the connection somewhere that was never checked.
 *
 * Every address must pass, not just the first: a name that answers with one
 * public and one private address is treated as private.
 */
export async function vetDestination(url: URL, opts: GuardOptions): Promise<ResolvedAddress> {
  const host = bareHostname(url)
  const port = urlPort(url)
  let addresses: ResolvedAddress[]
  if (isIPv4(host)) addresses = [{ address: host, family: 4 }]
  else if (isIPv6(host)) addresses = [{ address: host, family: 6 }]
  else {
    try {
      addresses = await opts.resolve(host)
    } catch (e) {
      throw new Error(`could not resolve ${host}: ${(e as Error).message}`, { cause: e })
    }
    if (addresses.length === 0) throw new Error(`could not resolve ${host}: no addresses`)
  }

  const named = (address: string): string => (address === host ? address : `${host} (${address})`)
  for (const { address } of addresses) {
    if (opts.enginePort !== undefined && port === opts.enginePort && isOwnAddress(address)) {
      throw new BlockedRequestError(
        `blocked: ${named(address)} port ${String(port)} is the engine's own API. No node ever calls it, even with internal addresses allowed.`,
      )
    }
    if (opts.allowInternal) continue
    const cls = internalAddressClass(address)
    if (cls !== null) {
      throw new BlockedRequestError(`blocked: ${named(address)} is a ${cls} address. ${ALLOW_INTERNAL_HINT}`)
    }
  }
  return addresses[0] as ResolvedAddress
}
