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

/** censys: host view via the Censys API (basic auth); records `port`/`technology` facts. */
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
  const apiId = resolveSecretParam(node.data.api_id, ctx, secrets, 'CENSYS_API_ID')
  const apiSecret = resolveSecretParam(node.data.api_secret, ctx, secrets, 'CENSYS_API_SECRET')
  if (apiId === '' || apiSecret === '') {
    finishBuiltin(
      deps,
      executionId,
      node.id,
      'failed',
      'Censys credentials not configured (set the CENSYS_API_ID and CENSYS_API_SECRET secrets)',
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
  const url = `https://search.censys.io/api/v2/hosts/${encodeURIComponent(value)}`
  const authHeader = `Basic ${Buffer.from(`${apiId}:${apiSecret}`).toString('base64')}`
  try {
    const res = await fetch(url, {
      headers: { authorization: authHeader, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text)
    if (!res.ok) {
      finishBuiltin(deps, executionId, node.id, 'failed', `censys HTTP ${res.status}: ${text.slice(0, 200)}`, [], stdoutPath)
      return
    }
    const body = JSON.parse(text) as { result?: { services?: Array<Record<string, unknown>> } }
    const services = body.result?.services ?? []
    const rows: Array<Record<string, unknown>> = []
    if (target !== undefined) {
      for (const svc of services) {
        const portRow: Record<string, unknown> = { port: svc.port, transport: svc.transport_protocol ?? 'TCP' }
        if (svc.service_name !== undefined) portRow.service = svc.service_name
        deps.project.facts.record({ targetId: target.id, kind: 'port', executionId, nodeId: node.id, data: portRow })
        rows.push(portRow)
        if (typeof svc.service_name === 'string' && svc.service_name !== '') {
          deps.project.facts.record({
            targetId: target.id,
            kind: 'technology',
            executionId,
            nodeId: node.id,
            data: { name: svc.service_name, source: 'censys' },
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
