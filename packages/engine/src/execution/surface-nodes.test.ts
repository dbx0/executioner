import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphSchema } from '@exe/graph'
import type { ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'
import {
  bucketCandidates,
  certificateFromPeer,
  type CertificateInfo,
  type DnsLookup,
  type TlsProbe,
} from './graph-executor/builtin/surface-drivers.js'

let dir: string
let project: Project
const manifests = new Map<string, ToolManifest>()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-surface-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

interface Drivers {
  probeTls?: TlsProbe
  dnsLookup?: DnsLookup
}

function newExecutor(drivers: Drivers = {}): GraphExecutor {
  return new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs, ...drivers })
}

async function runNode(
  type: string,
  data: Record<string, unknown>,
  targetId: string,
  drivers: Drivers = {},
): Promise<{ status: string | undefined; rows: Array<Record<string, unknown>> }> {
  const graph = graphSchema.parse({ nodes: [{ id: 'n', type, data }], edges: [] })
  const exec = newExecutor(drivers)
  const result = await exec.run({ graph, workflowId: null, targetId, testMode: false })
  const node = exec['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'n')
  return { status: node?.status, rows: (node?.parsedOutput ?? []) as Array<Record<string, unknown>> }
}

const dnsOf = (answers: Record<string, string[]>, reverse: Record<string, string[]> = {}): DnsLookup => ({
  resolve: async (name, type) => answers[`${name} ${type}`] ?? [],
  reverse: async (ip) => reverse[ip] ?? [],
})

const CERT: CertificateInfo = {
  subject_cn: 'example.com',
  issuer: "Let's Encrypt R11",
  not_before: '2026-10-01T00:00:00.000Z',
  not_after: '2026-12-30T00:00:00.000Z',
  sans: 'example.com,www.example.com',
  serial: '04AB',
  fingerprint_sha256: 'AA:BB',
}

describe('certificateFromPeer', () => {
  it('reads names, issuer and ISO validity dates out of a peer certificate', () => {
    const info = certificateFromPeer({
      subject: { CN: 'example.com' },
      issuer: { CN: 'R11', O: "Let's Encrypt" },
      subjectaltname: 'DNS:example.com, DNS:www.example.com, IP Address:93.184.216.34',
      valid_from: 'Oct  1 00:00:00 2026 GMT',
      valid_to: 'Dec 30 00:00:00 2026 GMT',
      serialNumber: '04AB',
      fingerprint256: 'AA:BB',
    })
    expect(info).toEqual({
      subject_cn: 'example.com',
      issuer: "Let's Encrypt R11",
      not_before: '2026-10-01T00:00:00.000Z',
      not_after: '2026-12-30T00:00:00.000Z',
      sans: 'example.com,www.example.com,93.184.216.34',
      serial: '04AB',
      fingerprint_sha256: 'AA:BB',
    })
  })

  it('returns null for the empty object node hands back when no certificate was presented', () => {
    expect(certificateFromPeer({})).toBeNull()
  })
})

describe('tls_cert node', () => {
  it('records the certificate on the host and reports the days left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-20T00:00:00.000Z'))
    const probe = vi.fn<TlsProbe>(async () => CERT)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })

    const { status, rows } = await runNode('tls_cert', {}, target.id, { probeTls: probe })

    expect(status).toBe('succeeded')
    expect(probe).toHaveBeenCalledWith('example.com', 443, expect.any(Number))
    expect(rows).toEqual([{ host: 'example.com', port: 443, ...CERT, days_left: 10, expired: false }])
    expect(project.facts.forTarget(target.id, 'certificate').map((f) => f.data)).toEqual([
      { host: 'example.com', port: 443, ...CERT },
    ])
  })

  it('takes the host and port out of a url target and files the fact on the host', async () => {
    const probe = vi.fn<TlsProbe>(async () => CERT)
    const url = project.targets.upsert({ kind: 'url', value: 'https://example.com:8443/login', source: 'manual' })

    const { status } = await runNode('tls_cert', {}, url.id, { probeTls: probe })

    expect(status).toBe('succeeded')
    expect(probe).toHaveBeenCalledWith('example.com', 8443, expect.any(Number))
    const host = project.targets.findByValue('domain', 'example.com')
    expect(project.facts.forTarget(host!.id, 'certificate')).toHaveLength(1)
    expect(project.facts.forTarget(url.id, 'certificate')).toHaveLength(0)
  })

  it('fails with the handshake error when the port does not speak TLS', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const { status } = await runNode('tls_cert', {}, target.id, {
      probeTls: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(status).toBe('failed')
    expect(project.facts.forTarget(target.id, 'certificate')).toHaveLength(0)
  })
})

describe('dns_records node', () => {
  it('records one fact per answered type and a row per answer', async () => {
    const target = project.targets.upsert({ kind: 'subdomain', value: 'shop.example.com', source: 'manual' })
    const dns = dnsOf({
      'shop.example.com A': ['93.184.216.34', '93.184.216.35'],
      'shop.example.com CNAME': ['shops.myshopify.com'],
    })

    const { status, rows } = await runNode('dns_records', {}, target.id, { dnsLookup: dns })

    expect(status).toBe('succeeded')
    expect(rows).toEqual([
      { name: 'shop.example.com', type: 'A', value: '93.184.216.34' },
      { name: 'shop.example.com', type: 'A', value: '93.184.216.35' },
      { name: 'shop.example.com', type: 'CNAME', value: 'shops.myshopify.com' },
    ])
    expect(project.facts.forTarget(target.id, 'dns_record').map((f) => f.data)).toEqual([
      { name: 'shop.example.com', type: 'A', value: '93.184.216.34,93.184.216.35' },
      { name: 'shop.example.com', type: 'CNAME', value: 'shops.myshopify.com' },
    ])
  })

  it('stores an answer set in a stable order, so a rotated reply is not a change', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const dns = dnsOf({
      'example.com A': ['93.184.216.35', '93.184.216.34'],
      'example.com MX': ['mx1.example.com', 'backup.example.com'],
    })
    await runNode('dns_records', {}, target.id, { dnsLookup: dns })
    expect(project.facts.forTarget(target.id, 'dns_record').map((f) => f.data.value)).toEqual([
      '93.184.216.34,93.184.216.35',
      // MX arrives in priority order, which is information, so it is kept.
      'mx1.example.com,backup.example.com',
    ])
  })

  it('files each address a name resolves to as a child ip target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await runNode('dns_records', {}, target.id, { dnsLookup: dnsOf({ 'example.com A': ['93.184.216.34'] }) })
    const ip = project.targets.findByValue('ip', '93.184.216.34')
    expect(ip?.parentId).toBe(target.id)
  })

  it('asks only for the record types the node names', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const resolve = vi.fn<DnsLookup['resolve']>(async () => [])
    await runNode('dns_records', { record_types: 'mx, txt' }, target.id, {
      dnsLookup: { resolve, reverse: async () => [] },
    })
    expect(resolve.mock.calls.map((c) => c[1])).toEqual(['MX', 'TXT'])
  })

  it('reverse-resolves an ip target and files the names it finds as targets', async () => {
    const target = project.targets.upsert({ kind: 'ip', value: '93.184.216.34', source: 'manual' })
    const dns = dnsOf({}, { '93.184.216.34': ['edge1.example.net', 'edge1.example.net.'] })

    const { status, rows } = await runNode('dns_records', {}, target.id, { dnsLookup: dns })

    expect(status).toBe('succeeded')
    expect(rows).toEqual([{ name: '93.184.216.34', type: 'PTR', value: 'edge1.example.net' }])
    expect(project.facts.forTarget(target.id, 'dns_record').map((f) => f.data)).toEqual([
      { name: '93.184.216.34', type: 'PTR', value: 'edge1.example.net' },
    ])
    expect(project.targets.findByValue('subdomain', 'edge1.example.net')).toBeDefined()
  })

  it('succeeds with no rows when a name has no records, rather than failing the run', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const { status, rows } = await runNode('dns_records', {}, target.id, { dnsLookup: dnsOf({}) })
    expect(status).toBe('succeeded')
    expect(rows).toEqual([])
  })
})

/** A RIPEstat stand-in: answers by data call name, and records what was asked. */
function stubRipe(prefixes: string[], asked: string[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
      asked.push(`${url.pathname.split('/')[2] ?? ''} ${url.searchParams.get('resource') ?? ''}`)
      const body = url.pathname.includes('network-info')
        ? { data: { asns: ['64500'], prefix: '203.0.113.0/24' } }
        : url.pathname.includes('as-overview')
          ? { data: { holder: 'EXAMPLE-NET - Example Hosting' } }
          : { data: { prefixes: prefixes.map((prefix) => ({ prefix })) } }
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
}

describe('cloud_buckets node on azure', () => {
  it('reads any answer from a storage account name as proof the account exists', async () => {
    // A missing account does not resolve; an existing one answers an anonymous
    // listing with 404 ResourceNotFound, which is not "no such account".
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input)
        if (url === 'https://acmedata.blob.core.windows.net/?comp=list') return new Response('', { status: 404 })
        if (url.includes('.blob.core.windows.net')) throw new TypeError('fetch failed')
        return new Response('', { status: 404 })
      }),
    )
    const target = project.targets.upsert({ kind: 'domain', value: 'acme.com', source: 'manual' })

    const { rows } = await runNode('cloud_buckets', {}, target.id)

    expect(rows).toEqual([
      { provider: 'azure', bucket: 'acmedata', url: 'https://acmedata.blob.core.windows.net/?comp=list', access: 'protected', status_code: 404 },
    ])
  })
})

describe('asn node', () => {
  it('finds the AS that announces an ip and files its IPv4 ranges as targets', async () => {
    const asked: string[] = []
    stubRipe(['203.0.113.0/24', '198.51.100.0/24', '2001:db8::/32'], asked)
    const target = project.targets.upsert({ kind: 'ip', value: '203.0.113.7', source: 'manual' })

    const { status, rows } = await runNode('asn', {}, target.id)

    expect(status).toBe('succeeded')
    expect(asked[0]).toBe('network-info 203.0.113.7')
    expect(asked).toContain('announced-prefixes AS64500')
    expect(rows).toEqual([
      { asn: 'AS64500', holder: 'EXAMPLE-NET - Example Hosting', prefix: '203.0.113.0/24' },
      { asn: 'AS64500', holder: 'EXAMPLE-NET - Example Hosting', prefix: '198.51.100.0/24' },
    ])
    expect(project.targets.findByValue('cidr', '203.0.113.0/24')).toBeDefined()
    expect(project.targets.findByValue('cidr', '198.51.100.0/24')).toBeDefined()
    expect(project.targets.findByValue('cidr', '2001:db8::/32')).toBeUndefined()
  })

  it('takes an AS number directly, without looking an address up first', async () => {
    const asked: string[] = []
    stubRipe(['203.0.113.0/24'], asked)
    const target = project.targets.upsert({ kind: 'ip', value: '203.0.113.7', source: 'manual' })

    const { status } = await runNode('asn', { target: 'as64500' }, target.id)

    expect(status).toBe('succeeded')
    expect(asked.some((a) => a.startsWith('network-info'))).toBe(false)
    expect(asked).toContain('announced-prefixes AS64500')
  })

  it('returns the ranges but files none when the AS is bigger than max_prefixes', async () => {
    // A host on a cloud provider sits in an AS with thousands of ranges that are
    // nothing to do with the engagement; those must not flood the target tree.
    stubRipe(['203.0.113.0/24', '198.51.100.0/24', '192.0.2.0/24'])
    const target = project.targets.upsert({ kind: 'ip', value: '203.0.113.7', source: 'manual' })

    const { status, rows } = await runNode('asn', { max_prefixes: 2 }, target.id)

    expect(status).toBe('succeeded')
    expect(rows).toHaveLength(3)
    expect(project.targets.findByValue('cidr', '203.0.113.0/24')).toBeUndefined()
  })

  it('fails on a hostname, which has no AS of its own', async () => {
    stubRipe([])
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const { status } = await runNode('asn', {}, target.id)
    expect(status).toBe('failed')
  })
})

describe('bucketCandidates', () => {
  it('builds names from the keyword, the built-in suffixes and the extra words', () => {
    const names = bucketCandidates('Example', 'Media-Team\n\n  qa ')
    expect(names[0]).toBe('example')
    expect(names).toContain('example-backup')
    expect(names).toContain('example-media-team')
    expect(names).toContain('example-qa')
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('cloud_buckets node', () => {
  const statusByUrl: Record<string, number> = {
    'https://example-dev.s3.amazonaws.com/': 403,
    'https://storage.googleapis.com/example-backup/': 200,
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input)
        // No such storage account: the name does not resolve at all.
        if (url.includes('.blob.core.windows.net')) throw new TypeError('fetch failed')
        return new Response('', { status: statusByUrl[url] ?? 404 })
      }),
    )
  })

  it('files the buckets that exist, telling an open listing from a protected one', async () => {
    const target = project.targets.upsert({ kind: 'subdomain', value: 'www.example.com', source: 'manual' })

    const { status, rows } = await runNode('cloud_buckets', {}, target.id)

    expect(status).toBe('succeeded')
    expect(rows).toEqual([
      { provider: 's3', bucket: 'example-dev', url: 'https://example-dev.s3.amazonaws.com/', access: 'protected', status_code: 403 },
      { provider: 'gcs', bucket: 'example-backup', url: 'https://storage.googleapis.com/example-backup/', access: 'open', status_code: 200 },
    ])
    const open = project.targets.findByValue('url', 'https://storage.googleapis.com/example-backup/')
    expect(open).toBeDefined()
    expect(project.facts.forTarget(open!.id, 'http_service').map((f) => f.data)).toEqual([
      { url: 'https://storage.googleapis.com/example-backup/', status_code: 200, title: 'Google Cloud Storage bucket, open listing' },
    ])
  })

  it('uses the keyword param instead of the target name when one is given', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes('.blob.core.windows.net')) throw new TypeError('fetch failed')
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })

    const { status, rows } = await runNode('cloud_buckets', { keyword: 'acme' }, target.id)

    expect(status).toBe('succeeded')
    expect(rows).toEqual([])
    const asked = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(asked).toContain('https://acme.s3.amazonaws.com/')
    expect(asked.some((u) => u.includes('example'))).toBe(false)
  })
})
