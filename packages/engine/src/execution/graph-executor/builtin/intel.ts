import type { Target } from '@exe/protocol'
import type { LoopContext, NodeOutput } from '../../../infra/template-scope.js'
import { resolveNodeTarget, resolveSecretParam, scopeFor, writeBuiltinEvidence } from '../helpers.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'

/** geoip: keyless geolocation lookup via ip-api.com; records a `geolocation` fact. */
export async function runGeoip(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
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
  if (value === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no target to geolocate', [], null)
    return
  }
  const timeoutMs = Number(node.data.timeout ?? 15000)
  const url = `http://ip-api.com/json/${encodeURIComponent(value)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    const data = JSON.parse(text) as Record<string, unknown>
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text)
    if (data.status === 'fail') {
      finishBuiltin(deps, executionId, node.id, 'failed', String(data.message ?? 'geoip lookup failed'), [], stdoutPath)
      return
    }
    if (target !== undefined) {
      deps.project.facts.record({
        targetId: target.id,
        kind: 'geolocation',
        executionId,
        nodeId: node.id,
        data,
      })
    }
    nodeOutputs[node.id] = { output: text, rows: [data] }
    finishBuiltin(deps, executionId, node.id, 'succeeded', text, [data], stdoutPath)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}

/** shodan: host lookup via the Shodan API; records `port`/`technology` facts. */
export async function runShodan(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
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
  const key = resolveSecretParam(node.data.api_key, ctx, secrets, 'SHODAN_API_KEY')
  if (key === '') {
    finishBuiltin(
      deps,
      executionId,
      node.id,
      'failed',
      'Shodan API key not configured (set the SHODAN_API_KEY secret)',
      [],
      null,
    )
    return
  }
  if (value === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no target to query', [], null)
    return
  }
  const timeoutMs = Number(node.data.timeout ?? 30000)
  const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(value)}?key=${encodeURIComponent(key)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text)
    if (!res.ok) {
      finishBuiltin(deps, executionId, node.id, 'failed', `shodan HTTP ${res.status}: ${text.slice(0, 200)}`, [], stdoutPath)
      return
    }
    const host = JSON.parse(text) as {
      ip_str?: string
      hostnames?: string[]
      ports?: number[]
      data?: Array<Record<string, unknown>>
    }
    const rows: Array<Record<string, unknown>> = []
    if (target !== undefined) {
      for (const item of host.data ?? []) {
        const portRow: Record<string, unknown> = {
          port: item.port,
          transport: item.transport ?? 'tcp',
        }
        if (item.product !== undefined) portRow.service = item.product
        if (item.version !== undefined) portRow.version = item.version
        deps.project.facts.record({ targetId: target.id, kind: 'port', executionId, nodeId: node.id, data: portRow })
        rows.push(portRow)
        if (typeof item.product === 'string' && item.product !== '') {
          const techRow: Record<string, unknown> = { name: item.product, source: 'shodan' }
          if (item.version !== undefined) techRow.version = item.version
          deps.project.facts.record({ targetId: target.id, kind: 'technology', executionId, nodeId: node.id, data: techRow })
        }
      }
    }
    const summary = {
      ip: host.ip_str ?? value,
      hostnames: host.hostnames ?? [],
      ports: host.ports ?? [],
    }
    const outRows = rows.length > 0 ? rows : [summary]
    nodeOutputs[node.id] = { output: text, rows: outRows }
    finishBuiltin(deps, executionId, node.id, 'succeeded', text, outRows, stdoutPath)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}

/**
 * censys: host view via the Censys Platform API (personal access token, plus an
 * organization ID on paid plans); records `port`/`technology` facts.
 */
export async function runCensys(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
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
  const token = resolveSecretParam(node.data.api_token, ctx, secrets, 'CENSYS_API_TOKEN')
  const orgId = resolveSecretParam(node.data.org_id, ctx, secrets, 'CENSYS_ORG_ID')
  if (token === '') {
    finishBuiltin(
      deps,
      executionId,
      node.id,
      'failed',
      'Censys token not configured (set the CENSYS_API_TOKEN secret to a Censys Platform personal access token)',
      [],
      null,
    )
    return
  }
  if (value === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no target to query', [], null)
    return
  }
  const timeoutMs = Number(node.data.timeout ?? 30000)
  const url = `https://api.platform.censys.io/v3/global/asset/host/${encodeURIComponent(value)}`
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' }
  // Free accounts have no organization; paid plans need it to use their entitlements.
  if (orgId !== '') headers['x-organization-id'] = orgId
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text)
    if (!res.ok) {
      finishBuiltin(deps, executionId, node.id, 'failed', `censys HTTP ${res.status}: ${text.slice(0, 200)}`, [], stdoutPath)
      return
    }
    const body = JSON.parse(text) as { result?: { resource?: { services?: Array<Record<string, unknown>> } } }
    const services = body.result?.resource?.services ?? []
    const rows: Array<Record<string, unknown>> = []
    if (target !== undefined) {
      for (const svc of services) {
        // Censys labels services it could not identify as UNKNOWN; that is not a technology.
        const protocol = typeof svc.protocol === 'string' && svc.protocol !== 'UNKNOWN' ? svc.protocol : ''
        const portRow: Record<string, unknown> = { port: svc.port, transport: svc.transport_protocol ?? 'tcp' }
        if (protocol !== '') portRow.service = protocol
        deps.project.facts.record({ targetId: target.id, kind: 'port', executionId, nodeId: node.id, data: portRow })
        rows.push(portRow)
        if (protocol !== '') {
          deps.project.facts.record({
            targetId: target.id,
            kind: 'technology',
            executionId,
            nodeId: node.id,
            data: { name: protocol, source: 'censys' },
          })
        }
      }
    }
    const outRows = rows.length > 0 ? rows : [{ ip: value, services: services.length }]
    nodeOutputs[node.id] = { output: text, rows: outRows }
    finishBuiltin(deps, executionId, node.id, 'succeeded', text, outRows, stdoutPath)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}
