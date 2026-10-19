import { existsSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { buildAdjacency, Graph } from '@exe/graph'
import { interpolate } from '@exe/nodes'
import type { Project } from '@exe/project'
import type { Target } from '@exe/protocol'
import { buildScope, type LoopContext, type NodeOutput } from '../../infra/template-scope.js'

/** Build the template scope for a built-in node against the current run state. */
export function scopeFor(
  project: Project,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  /** Present when the node sits in a loop body, so `{{ loop.item }}` resolves. */
  loop?: LoopContext | undefined,
): Record<string, unknown> {
  const scope = buildScope({
    params: {},
    target: target === undefined ? { value: '', kind: 'domain' } : { value: target.value, kind: target.kind },
    runDir: project.evidenceDir(executionId),
    nodeOutputs,
    vars,
    secrets,
    ...(loop !== undefined ? { loop } : {}),
  })
  return { ...scope }
}

/** The rows produced by every node feeding into `nodeId`. */
export function upstreamRows(nodeId: string, graph: Graph, nodeOutputs: Record<string, NodeOutput>): Array<Record<string, unknown>> {
  const sources = graph.edges.filter((e) => e.target === nodeId).map((e) => e.source)
  return sources.flatMap((s) => nodeOutputs[s]?.rows ?? [])
}

/** Resolve a node's `target` param (templated) or fall back to the run target's value. */
export function resolveNodeTarget(
  node: { data: Record<string, unknown> },
  target: Target | undefined,
  ctx: Record<string, unknown>,
): string {
  const raw = node.data.target
  if (typeof raw === 'string' && raw.trim() !== '') {
    return (interpolate(raw, ctx) ?? raw).trim()
  }
  return (target?.value ?? '').trim()
}

/** Resolve an API credential from a node param (templated, may reference {{ secrets.X }}) or a named secret. */
export function resolveSecretParam(
  raw: unknown,
  ctx: Record<string, unknown>,
  secrets: Record<string, string>,
  secretName: string,
): string {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const resolved = interpolate(raw, ctx)
    if (resolved !== undefined && resolved.trim() !== '') return resolved.trim()
  }
  return (secrets[secretName] ?? '').trim()
}

/** Locate a Chrome/Chromium binary, or null if none is available. */
export function findChromeBinary(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p): p is string => typeof p === 'string' && p !== '')
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
    if (onPath(name)) return name
  }
  return null
}

/** Locate a python interpreter, or null if none is available. */
export function findPythonBinary(): string | null {
  for (const name of ['python3', 'python']) {
    if (onPath(name)) return name
  }
  return null
}

/** Whether a bare command name resolves on PATH (synchronous, best-effort). */
export function onPath(name: string): boolean {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  return dirs.some((d) => d !== '' && existsSync(`${d}/${name}`))
}

/** Spawn a command, capturing stdout/stderr with a hard timeout. */
export function spawnCapture(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`command timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Write a built-in node's raw output into the run's evidence dir. */
export function writeBuiltinEvidence(project: Project, executionId: string, nodeId: string, text: string): string {
  const dir = project.evidenceDir(executionId)
  const path = `${dir}/${nodeId}.stdout`
  try {
    writeFileSync(path, text)
  } catch {
    /* best-effort evidence */
  }
  return path
}

/** Persist a built-in node's stderr next to its stdout. Returns the path, or
 *  null when there was nothing to write, so callers can record it verbatim. */
export function writeBuiltinStderr(
  project: Project,
  executionId: string,
  nodeId: string,
  text: string,
): string | null {
  if (text === '') return null
  const path = `${project.evidenceDir(executionId)}/${nodeId}.stderr`
  try {
    writeFileSync(path, text)
  } catch {
    return null
  }
  return path
}

/** The parsed first row of the most recent upstream node, used as IF `data`. */
export function lastUpstreamRow(
  nodeId: string,
  adj: ReturnType<typeof buildAdjacency>,
  nodeOutputs: Record<string, NodeOutput>,
): Record<string, unknown> {
  for (const rev of adj.reverse.get(nodeId) ?? []) {
    const out = nodeOutputs[rev.source]
    if (out !== undefined && out.rows[0] !== undefined) return out.rows[0]
  }
  return {}
}

/** LOOP source resolves to a JSON array if parseable, else newline-split lines. */
export function resolveLoopItems(
  project: Project,
  source: unknown,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
): unknown[] {
  if (typeof source !== 'string') return []
  const runDir = project.evidenceDir(executionId)
  const scope = buildScope({
    params: {},
    target: target === undefined ? { value: '', kind: 'domain' } : { value: target.value, kind: target.kind },
    runDir,
    nodeOutputs,
  })
  const scopeCtx: Record<string, unknown> = { ...scope }
  const resolved = interpolate(source, scopeCtx) ?? source
  try {
    const parsed = JSON.parse(resolved)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // not JSON, fall through to line splitting
  }
  return resolved
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}
