import { escapeJsonString, interpolate } from '@exe/nodes'
import { canonicaliseAsset, evaluateScope, isCanonicalAsset, type ScopeRule, type Target } from '@exe/protocol'
import type { LoopContext, NodeOutput } from '../../../infra/template-scope.js'
import { scopeFor, writeBuiltinEvidence, writeBuiltinStderr } from '../helpers.js'
import { guardedRequest } from './http-client.js'
import { systemResolver } from './http-guard.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 10 * 60_000
const NOTIFY_TIMEOUT_MS = 15_000

/** An HTTP header name: an RFC 9110 token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** Characters that would end a header line and start another. */
const HEADER_BREAK = /[\r\n\0]/

/**
 * Builds a request body from its template. Each substituted value is encoded
 * for where it lands, as the python_script node does for its string literals: a
 * JSON body gets JSON string escapes, a form body percent-encoding, and a raw
 * body is sent as written. A value pulled from tool output therefore stays one
 * value; it cannot close its string and add keys, or add `&admin=1` to a form.
 */
export function buildRequestBody(template: string, bodyType: string, ctx: Record<string, unknown>): string {
  const encode =
    bodyType === 'json' ? escapeJsonString : bodyType === 'form' ? encodeURIComponent : (value: string): string => value
  return interpolate(template, ctx, encode) ?? template
}

/**
 * Parses the headers param (a JSON object) and resolves placeholders in each
 * value. The object is parsed before anything is substituted, so a value can
 * never reshape it, and a name or value that would break the header line (CR,
 * LF, NUL) fails the node instead of injecting a header of its own.
 */
export function buildRequestHeaders(raw: unknown, ctx: Record<string, unknown>): Record<string, string> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed headers have always been ignored rather than failing the node.
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) continue
    const text = String(value)
    const resolved = interpolate(text, ctx) ?? text
    if (!HEADER_NAME.test(name)) throw new Error(`header name ${JSON.stringify(name)} is not a valid HTTP header name`)
    if (HEADER_BREAK.test(resolved)) {
      throw new Error(`header ${name} contains a line break or NUL, which would inject another header; refused`)
    }
    headers[name.toLowerCase()] = resolved
  }
  return headers
}

/**
 * Judges one hop against the engagement's scope rules. Only an explicit
 * exclusion refuses: `unknown` passes, because a scope paste is routinely
 * incomplete (see evaluateScope). Both the url (host and path rules) and the
 * address it resolved to (network rules) are judged.
 */
export function outOfScopeReason(url: URL, address: string, rules: ScopeRule[]): string | null {
  if (rules.length === 0) return null
  for (const input of [
    { kind: 'url', value: url.toString() },
    { kind: 'ip', value: address },
  ]) {
    const asset = canonicaliseAsset(input)
    if (!isCanonicalAsset(asset)) continue
    const verdict = evaluateScope(asset, rules)
    if (verdict.status === 'out') {
      return `blocked: ${input.value} is out of the engagement's scope (${verdict.reason}). Change the scope rules to reach it.`
    }
  }
  return null
}

/** The node's opt-in to internal addresses, as a checkbox or an imported string. */
function allowsInternal(data: Record<string, unknown>): boolean {
  return data.allow_internal === true || data.allow_internal === 'true'
}

/** A timeout param in milliseconds, clamped, with `fallback` when unset or invalid. */
function timeoutParam(raw: unknown, fallback: number): number {
  const timeout = Number(raw ?? fallback)
  return Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_TIMEOUT_MS) : fallback
}

/**
 * Fails the node with a message the operator can see. A refusal is only useful
 * if they learn why, so it goes to the node's stderr, live and on disk.
 */
function failNode(deps: BuiltinNodeDeps, executionId: string, nodeId: string, message: string): void {
  deps.bus.publish({ type: 'stderr', executionId, nodeId, data: `${message}\n` })
  const stderrPath = writeBuiltinStderr(deps.project, executionId, nodeId, `${message}\n`)
  finishBuiltin(deps, executionId, nodeId, 'failed', message, [], null, stderrPath)
}

/** http_request: perform an HTTP call, capturing the response as this node's output. */
export async function runHttpRequest(
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
  const method = String(node.data.method ?? 'GET').toUpperCase()
  const url = interpolate(String(node.data.url ?? ''), ctx) ?? String(node.data.url ?? '')
  const bodyType = String(node.data.body_type ?? 'json')
  const timeoutMs = timeoutParam(node.data.timeout, DEFAULT_TIMEOUT_MS)
  const allowInternal = allowsInternal(node.data)
  const fail = (message: string): void => failNode(deps, executionId, node.id, message)

  let headers: Record<string, string>
  try {
    headers = buildRequestHeaders(node.data.headers, ctx)
  } catch (e) {
    fail((e as Error).message)
    return
  }
  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD' && node.data.body !== undefined && node.data.body !== '') {
    body = buildRequestBody(String(node.data.body), bodyType, ctx)
    if (bodyType === 'json' && headers['content-type'] === undefined) headers['content-type'] = 'application/json'
    else if (bodyType === 'form' && headers['content-type'] === undefined)
      headers['content-type'] = 'application/x-www-form-urlencoded'
  }

  const rules = deps.project.scopeRules.all()
  try {
    const res = await guardedRequest({
      url,
      method,
      headers,
      body,
      timeoutMs,
      guard: { allowInternal, enginePort: deps.enginePort?.(), resolve: deps.resolveHost ?? systemResolver },
      judgeScope: (hop, address) => outOfScopeReason(hop, address, rules),
      send: deps.sendHttp,
    })
    const text = res.text
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    const rows = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [{ status: res.status, ok: res.ok, ...(parsed !== undefined ? { body: parsed } : { body: text }) }]
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, text)
    nodeOutputs[node.id] = { output: text, rows }
    finishBuiltin(deps, executionId, node.id, res.ok ? 'succeeded' : 'failed', text, rows, stdoutPath)
  } catch (e) {
    fail(String((e as Error).message))
  }
}

/**
 * notify: post a message to a Discord or Slack webhook. The webhook url is
 * user-supplied and may be templated from tool output, so it goes through the
 * same guarded client as http_request: an internal address, or a redirect to
 * one, is refused unless the node opts in with allow_internal, and the engine's
 * own port is refused even then.
 */
export async function runNotify(
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
  const platform = String(node.data.platform ?? 'discord')
  const webhookUrl = interpolate(String(node.data.webhook_url ?? ''), ctx) ?? String(node.data.webhook_url ?? '')
  const message = interpolate(String(node.data.message ?? ''), ctx) ?? String(node.data.message ?? '')
  const timeoutMs = timeoutParam(node.data.timeout, NOTIFY_TIMEOUT_MS)
  const allowInternal = allowsInternal(node.data)
  if (webhookUrl.trim() === '') {
    failNode(deps, executionId, node.id, 'missing webhook_url')
    return
  }
  // The message is substituted as plain text and the payload serialised after,
  // so a templated value can only ever be the message, never another key.
  const payload = platform === 'slack' ? { text: message } : { content: message }
  const rules = deps.project.scopeRules.all()
  try {
    const res = await guardedRequest({
      url: webhookUrl,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs,
      guard: { allowInternal, enginePort: deps.enginePort?.(), resolve: deps.resolveHost ?? systemResolver },
      judgeScope: (hop, address) => outOfScopeReason(hop, address, rules),
      send: deps.sendHttp,
    })
    const row = { platform, status: res.status, ok: res.ok }
    nodeOutputs[node.id] = { output: JSON.stringify(row), rows: [row] }
    finishBuiltin(deps, executionId, node.id, res.ok ? 'succeeded' : 'failed', JSON.stringify(row), [row], null)
  } catch (e) {
    failNode(deps, executionId, node.id, String((e as Error).message))
  }
}
