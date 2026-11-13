import { isIP } from 'node:net'
import type { Target } from '@exe/protocol'
import type { LoopContext, NodeOutput } from '../../../infra/template-scope.js'
import { resolveNodeTarget, scopeFor, writeBuiltinEvidence } from '../helpers.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'
import {
  bucketCandidates,
  DNS_RECORD_TYPES,
  systemDns,
  tlsProbe,
  type DnsRecordType,
} from './surface-drivers.js'

type Row = Record<string, unknown>
type Node = { id: string; data: Record<string, unknown> }

/** Hostnames compare case-insensitively and a trailing dot is the same name. */
const cleanName = (name: string): string => name.trim().toLowerCase().replace(/\.$/, '')

/** The host (and port, when one was written) inside a url, a `host:port` or a bare host. */
function hostOf(value: string): { host: string; port: number | null } {
  if (value.includes('://')) {
    try {
      const url = new URL(value)
      return {
        host: cleanName(url.hostname.replace(/^\[|\]$/g, '')),
        port: url.port === '' ? null : Number(url.port),
      }
    } catch {
      return { host: '', port: null }
    }
  }
  const withPort = isIP(value) === 0 ? /^(.+):(\d+)$/.exec(value) : null
  if (withPort !== null) return { host: cleanName(withPort[1] ?? ''), port: Number(withPort[2]) }
  return { host: cleanName(value), port: null }
}

/**
 * The target a host's facts belong on. The run target when that is the host;
 * otherwise the host's own row, created if it is new. No parent is passed: the
 * tree derives one from the value, and handing it the run target could hang a
 * host under its own url. Undefined when the value is not a storable asset.
 */
function hostTarget(deps: BuiltinNodeDeps, runTarget: Target | undefined, host: string, nodeId: string): Target | undefined {
  if (runTarget !== undefined && runTarget.value === host) return runTarget
  try {
    return deps.project.targets.upsert({ kind: isIP(host) === 0 ? 'domain' : 'ip', value: host, source: nodeId })
  } catch {
    return undefined
  }
}

/** Files a discovered asset, ignoring a value the tree refuses (a wildcard, a malformed name). */
function fileTarget(deps: BuiltinNodeDeps, input: Parameters<BuiltinNodeDeps['project']['targets']['upsert']>[0]): Target | undefined {
  try {
    return deps.project.targets.upsert(input)
  } catch {
    return undefined
  }
}

const numberParam = (raw: unknown, fallback: number): number => {
  const n = Number(raw)
  return raw === undefined || raw === null || raw === '' || !Number.isFinite(n) ? fallback : n
}

/** tls_cert: one TLS handshake; records what the port serves as a `certificate` fact. */
export async function runTlsCert(
  deps: BuiltinNodeDeps,
  node: Node,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): Promise<void> {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  const { host, port: writtenPort } = hostOf(resolveNodeTarget(node, target, ctx))
  if (host === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no host to read a certificate from', [], null)
    return
  }
  const port = numberParam(node.data.port, writtenPort ?? 443)
  const timeoutMs = numberParam(node.data.timeout, 15000)
  try {
    const info = await (deps.probeTls ?? tlsProbe)(host, port, timeoutMs)
    const data = { host, port, ...info }
    const owner = hostTarget(deps, target, host, node.id)
    if (owner !== undefined) {
      deps.project.facts.record({ targetId: owner.id, kind: 'certificate', executionId, nodeId: node.id, data })
    }
    // Derived from the clock, so they live on the row and not on the stored fact,
    // which would be wrong the day after it was written.
    const msLeft = new Date(info.not_after).getTime() - Date.now()
    const row: Row = { ...data, days_left: Math.floor(msLeft / 86_400_000), expired: msLeft < 0 }
    const text = JSON.stringify(row, null, 2)
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text, loop)
    nodeOutputs[node.id] = { output: text, rows: [row] }
    finishBuiltin(deps, executionId, node.id, 'succeeded', text, [row], stdoutPath)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}

/** The record types a node asked for, in its order; the full set when it named none. */
function requestedTypes(raw: unknown): DnsRecordType[] {
  const asked = String(raw ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t): t is DnsRecordType => (DNS_RECORD_TYPES as readonly string[]).includes(t))
  return asked.length > 0 ? [...new Set(asked)] : [...DNS_RECORD_TYPES]
}

/**
 * dns_records: resolves a name's records, or reverse-resolves an address, and
 * records each answer set as a `dns_record` fact. Addresses a name points at
 * and names an address answers to are filed as targets.
 */
export async function runDnsRecords(
  deps: BuiltinNodeDeps,
  node: Node,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): Promise<void> {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  const { host } = hostOf(resolveNodeTarget(node, target, ctx))
  if (host === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no name or address to look up', [], null)
    return
  }
  const lookup = deps.dnsLookup ?? systemDns
  const owner = hostTarget(deps, target, host, node.id)
  const rows: Row[] = []
  const errors: string[] = []
  const record = (type: string, values: string[]): void => {
    if (values.length === 0) return
    for (const value of values) rows.push({ name: host, type, value })
    if (owner !== undefined) {
      deps.project.facts.record({
        targetId: owner.id,
        kind: 'dns_record',
        executionId,
        nodeId: node.id,
        data: { name: host, type, value: values.join(',') },
      })
    }
  }

  if (isIP(host) !== 0) {
    try {
      const names = [...new Set((await lookup.reverse(host)).map(cleanName))].filter((n) => n !== '')
      record('PTR', names)
      for (const name of names) fileTarget(deps, { kind: 'domain', value: name, source: node.id })
    } catch (e) {
      errors.push(`PTR: ${(e as Error).message}`)
    }
  } else {
    const types = requestedTypes(node.data.record_types)
    const answers = await Promise.allSettled(types.map((type) => lookup.resolve(host, type)))
    answers.forEach((answer, i) => {
      const type = types[i] as DnsRecordType
      if (answer.status === 'rejected') {
        errors.push(`${type}: ${String((answer.reason as Error).message)}`)
        return
      }
      // TXT is free text; every other answer is a name or an address.
      // A null MX (".") cleans to nothing: it says "no mail here", it is not a host.
      const values = [...new Set(type === 'TXT' ? answer.value : answer.value.map(cleanName))].filter((v) => v !== '')
      // Resolvers rotate the order of an answer set. Sorted, the stored record only
      // changes when the answer does. MX keeps its order: that is the priority.
      if (type !== 'MX') values.sort()
      record(type, values)
      if (type === 'A' || type === 'AAAA') {
        for (const ip of values) fileTarget(deps, { kind: 'ip', value: ip, source: node.id, parentId: owner?.id ?? null })
      }
    })
  }

  const text = JSON.stringify({ records: rows, errors }, null, 2)
  const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text, loop)
  // An empty answer is a result. Only a resolver that failed every question is a failure.
  if (rows.length === 0 && errors.length > 0) {
    finishBuiltin(deps, executionId, node.id, 'failed', errors.join('; '), [], stdoutPath)
    return
  }
  nodeOutputs[node.id] = { output: text, rows }
  finishBuiltin(deps, executionId, node.id, 'succeeded', text, rows, stdoutPath)
}

/** One RIPEstat data call; returns its `data` object. */
async function ripeStat(call: string, resource: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const url = `https://stat.ripe.net/data/${call}/data.json?resource=${encodeURIComponent(resource)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`RIPEstat ${call} HTTP ${String(res.status)}`)
  const body = (await res.json()) as { data?: Record<string, unknown> }
  return body.data ?? {}
}

/**
 * asn: finds the autonomous system that announces an address (or takes an AS
 * number as given) and lists the ranges it announces, via RIPEstat (no key).
 * The ranges are filed as targets only when there are at most `max_prefixes`
 * of them: an address on a cloud or CDN sits in an AS with thousands of ranges
 * that belong to everyone else.
 */
export async function runAsn(
  deps: BuiltinNodeDeps,
  node: Node,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): Promise<void> {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  const value = resolveNodeTarget(node, target, ctx)
  const timeoutMs = numberParam(node.data.timeout, 30000)
  const maxPrefixes = numberParam(node.data.max_prefixes, 100)
  const includeV6 = node.data.ipv6 === true || String(node.data.ipv6 ?? '') === 'true'
  try {
    let asn: string
    const written = /^as(\d+)$/i.exec(value)
    if (written !== null) {
      asn = `AS${written[1] ?? ''}`
    } else if (isIP(value) !== 0) {
      const info = await ripeStat('network-info', value, timeoutMs)
      const origin = Array.isArray(info.asns) ? info.asns[0] : undefined
      if (origin === undefined) {
        finishBuiltin(deps, executionId, node.id, 'failed', `no AS announces ${value}`, [], null)
        return
      }
      asn = `AS${String(origin)}`
    } else {
      finishBuiltin(deps, executionId, node.id, 'failed', 'asn needs an IP address or an AS number such as AS15169', [], null)
      return
    }

    const [announced, overview] = await Promise.all([
      ripeStat('announced-prefixes', asn, timeoutMs),
      // The holder name is a label; the lookup is still useful without it.
      ripeStat('as-overview', asn, timeoutMs).catch((): Record<string, unknown> => ({})),
    ])
    const holder = typeof overview.holder === 'string' ? overview.holder : ''
    const prefixes = (Array.isArray(announced.prefixes) ? announced.prefixes : [])
      .map((entry) => (entry as { prefix?: unknown }).prefix)
      .filter((prefix): prefix is string => typeof prefix === 'string')
      .filter((prefix) => includeV6 || !prefix.includes(':'))
    const rows: Row[] = prefixes.map((prefix) => ({ asn, holder, prefix }))

    const saved = prefixes.length <= maxPrefixes
    if (saved) for (const prefix of prefixes) fileTarget(deps, { kind: 'cidr', value: prefix, source: node.id })
    const text = JSON.stringify(
      {
        asn,
        holder,
        prefixes: prefixes.length,
        saved_as_targets: saved,
        ...(saved ? {} : { note: `more than max_prefixes (${String(maxPrefixes)}) ranges, so none were saved as targets` }),
        ranges: prefixes,
      },
      null,
      2,
    )
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text, loop)
    nodeOutputs[node.id] = { output: text, rows }
    finishBuiltin(deps, executionId, node.id, 'succeeded', text, rows, stdoutPath)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}

type BucketAccess = 'open' | 'protected'

interface BucketProbe {
  provider: 's3' | 'gcs' | 'azure'
  label: string
  bucket: string
  url: string
  /** What a response status says about the bucket; null when it does not exist. */
  classify: (status: number) => BucketAccess | null
}

/** 200 lists the bucket to anyone; 401/403 says it exists and is closed. */
const listable = (status: number): BucketAccess | null =>
  status === 200 ? 'open' : status === 401 || status === 403 ? 'protected' : null

function bucketProbes(names: string[]): BucketProbe[] {
  const s3 = names.map((bucket): BucketProbe => ({
    provider: 's3',
    label: 'Amazon S3 bucket',
    bucket,
    url: `https://${bucket}.s3.amazonaws.com/`,
    classify: listable,
  }))
  const gcs = names.map((bucket): BucketProbe => ({
    provider: 'gcs',
    label: 'Google Cloud Storage bucket',
    bucket,
    url: `https://storage.googleapis.com/${bucket}/`,
    classify: listable,
  }))
  // Storage account names are 3 to 24 letters and digits, with no hyphen. A name
  // that does not exist does not resolve, so any answer at all means it does:
  // an existing account answers an anonymous listing with 404 ResourceNotFound.
  const accounts = [...new Set(names.map((n) => n.replace(/-/g, '')))].filter((n) => n.length >= 3 && n.length <= 24)
  const azure = accounts.map((bucket): BucketProbe => ({
    provider: 'azure',
    label: 'Azure storage account',
    bucket,
    url: `https://${bucket}.blob.core.windows.net/?comp=list`,
    classify: (status) => (status === 200 ? 'open' : status < 500 ? 'protected' : null),
  }))
  return [...s3, ...gcs, ...azure]
}

/** The name an organisation is likely to put on its buckets: the registrable label. */
function keywordFor(target: Target | undefined): string {
  if (target === undefined) return ''
  const { host } = hostOf(target.value)
  if (host === '' || isIP(host) !== 0 || target.kind === 'cidr') return ''
  const labels = host.split('.')
  return (target.apex ?? '').split('.')[0] || (labels.length >= 2 ? (labels[labels.length - 2] ?? '') : (labels[0] ?? ''))
}

const BUCKET_CONCURRENCY = 8

/**
 * cloud_buckets: guesses bucket names from a keyword and asks S3, Google Cloud
 * Storage and Azure whether each exists. One unauthenticated GET per name per
 * provider; nothing is downloaded. What exists is filed as a url target with an
 * `http_service` fact saying whether it lists to anyone.
 */
export async function runCloudBuckets(
  deps: BuiltinNodeDeps,
  node: Node,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): Promise<void> {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  // `resolveNodeTarget` reads the `target` param; the same templating serves `keyword`.
  const written = resolveNodeTarget({ data: { target: node.data.keyword } }, undefined, ctx)
  const names = bucketCandidates(written !== '' ? written : keywordFor(target), String(node.data.wordlist ?? ''))
  if (names.length === 0) {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no keyword to build bucket names from (set the keyword param)', [], null)
    return
  }
  const timeoutMs = numberParam(node.data.timeout, 10000)
  const probes = bucketProbes(names)
  const found: Array<Row | null> = new Array<Row | null>(probes.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < probes.length; i = next++) {
      const probe = probes[i] as BucketProbe
      try {
        const res = await fetch(probe.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
        await res.body?.cancel()
        const access = probe.classify(res.status)
        if (access !== null) {
          found[i] = { provider: probe.provider, bucket: probe.bucket, url: probe.url, access, status_code: res.status }
        }
      } catch {
        // Unresolvable or unreachable: the bucket is not there to find.
      }
    }
  }
  await Promise.all(Array.from({ length: BUCKET_CONCURRENCY }, worker))

  const rows = found.filter((row): row is Row => row !== null)
  for (const row of rows) {
    const probe = probes.find((p) => p.url === row.url) as BucketProbe
    const filed = fileTarget(deps, { kind: 'url', value: probe.url, source: node.id })
    if (filed === undefined) continue
    deps.project.facts.record({
      targetId: filed.id,
      kind: 'http_service',
      executionId,
      nodeId: node.id,
      data: {
        url: probe.url,
        status_code: row.status_code,
        title: `${probe.label}, ${row.access === 'open' ? 'open listing' : probe.provider === 'azure' ? 'no anonymous listing' : 'access denied'}`,
      },
    })
  }
  const text = JSON.stringify({ names_tried: names.length, requests: probes.length, found: rows }, null, 2)
  const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text, loop)
  nodeOutputs[node.id] = { output: text, rows }
  finishBuiltin(deps, executionId, node.id, 'succeeded', text, rows, stdoutPath)
}
