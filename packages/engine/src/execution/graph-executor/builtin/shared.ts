import { isIP } from 'node:net'
import type { Project } from '@exe/project'
import type { Target } from '@exe/protocol'
import type { EventBus } from '../../../transport/events.js'
import type { RunRepository } from '@exe/db'
import type { Sender } from './http-client.js'
import type { Resolver } from './http-guard.js'
import type { ScreenshotDriver } from './screenshot-driver.js'
import type { DnsLookup, TlsProbe } from './surface-drivers.js'

/** The slice of the executor's dependencies the built-in node handlers need. */
export interface BuiltinNodeDeps {
  project: Project
  bus: EventBus
  store: RunRepository
  /** The port the engine's API listens on, which http_request and notify never call. */
  enginePort?: () => number
  /** How http_request and notify resolve hostnames. Absent → the system resolver. */
  resolveHost?: Resolver
  /** How http_request and notify put one vetted hop on the wire. Absent → node:http(s). */
  sendHttp?: Sender
  /** How the screenshot node captures a page. Absent → the real Chrome/CDP driver. */
  captureScreenshot?: ScreenshotDriver
  /** How tls_cert reads a served certificate. Absent → a real TLS handshake. */
  probeTls?: TlsProbe
  /** How dns_records resolves. Absent → the system resolvers. */
  dnsLookup?: DnsLookup
}

/** Emit the running/done lifecycle + persist a built-in node's result. */
export function finishBuiltin(
  deps: BuiltinNodeDeps,
  executionId: string,
  nodeId: string,
  status: 'succeeded' | 'failed',
  output: string,
  rows: Array<Record<string, unknown>>,
  stdoutPath: string | null,
  stderrPath: string | null = null,
): void {
  deps.store.recordNode({
    executionId,
    nodeId,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    stdoutPath,
    stderrPath,
    parsedOutput: rows,
  })
  deps.bus.publish({ type: 'done', executionId, nodeId, data: status })
}

/**
 * Whether a node should persist what it found. Mirrors the tool nodes' "Save
 * results to target" switch: off, the node still runs and still hands its rows
 * downstream, it just writes no fact and files no target.
 */
export function savesResults(node: { data: Record<string, unknown> }): boolean {
  return !(node.data.__no_save === true || String(node.data.__no_save ?? '') === 'true')
}

/** Hostnames compare case-insensitively and a trailing dot is the same name. */
export const cleanName = (name: string): string => name.trim().toLowerCase().replace(/\.$/, '')

/** The host (and port, when one was written) inside a url, a `host:port` or a bare host. */
export function hostOf(value: string): { host: string; port: number | null } {
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
export function hostTarget(deps: BuiltinNodeDeps, runTarget: Target | undefined, host: string, nodeId: string): Target | undefined {
  if (runTarget !== undefined && runTarget.value === host) return runTarget
  try {
    return deps.project.targets.upsert({ kind: isIP(host) === 0 ? 'domain' : 'ip', value: host, source: nodeId })
  } catch {
    return undefined
  }
}

/**
 * The target a built-in node's facts belong on, or undefined when it should
 * record nothing ("Save results to target" off, or no storable asset). A node
 * that names its own target, as one in a loop body does with the loop item,
 * files on that host; otherwise on the run's target, whatever its kind.
 */
export function resultOwner(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
  runTarget: Target | undefined,
  resolved: string,
): Target | undefined {
  if (!savesResults(node)) return undefined
  const named = typeof node.data.target === 'string' && node.data.target.trim() !== ''
  if (!named || resolved === runTarget?.value) return runTarget
  const { host } = hostOf(resolved)
  return host === '' ? undefined : hostTarget(deps, runTarget, host, node.id)
}
