import { existsSync, writeFileSync } from 'node:fs'
import { escapePythonString, interpolate } from '@exe/nodes'
import type { Target } from '@exe/protocol'
import type { LoopContext, NodeOutput } from '../../../infra/template-scope.js'
import {
  findChromeBinary,
  findPythonBinary,
  resolveNodeTarget,
  scopeFor,
  spawnCapture,
  writeBuiltinEvidence,
  writeBuiltinStderr,
} from '../helpers.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'

/** screenshot: capture a URL with the system headless Chrome; records a `screenshot` fact. */
export async function runScreenshot(
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
  let url = resolveNodeTarget(node, target, ctx)
  if (url === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no target to screenshot', [], null)
    return
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const chrome = findChromeBinary()
  if (chrome === null) {
    finishBuiltin(
      deps,
      executionId,
      node.id,
      'failed',
      'no Chrome/Chromium binary found (install Google Chrome or chromium)',
      [],
      null,
    )
    return
  }
  const dir = deps.project.evidenceDir(executionId)
  const outPath = `${dir}/${node.id}.png`
  const timeoutMs = Math.min(Math.max(5000, Number(node.data.timeout ?? 30000)), 120000)
  const args = [
    '--headless=new',
    '--disable-gpu',
    // Chrome's sandbox is what stands between a hostile page and this machine,
    // so it stays on. Chrome refuses to start sandboxed as root (a container),
    // which is the one case it is turned off.
    ...(isRoot() ? ['--no-sandbox'] : []),
    '--hide-scrollbars',
    `--screenshot=${outPath}`,
    '--window-size=1280,800',
    url,
  ]
  try {
    const result = await spawnCapture(chrome, args, timeoutMs)
    if (!existsSync(outPath)) {
      finishBuiltin(
        deps,
        executionId,
        node.id,
        'failed',
        `screenshot not produced${result.stderr !== '' ? `: ${result.stderr.slice(0, 200)}` : ''}`,
        [],
        null,
      )
      return
    }
    const row: Record<string, unknown> = { url, path: outPath, full_page: Boolean(node.data.full_page ?? false) }
    if (target !== undefined) {
      deps.project.facts.record({ targetId: target.id, kind: 'screenshot', executionId, nodeId: node.id, data: row })
    }
    nodeOutputs[node.id] = { output: outPath, rows: [row] }
    finishBuiltin(deps, executionId, node.id, 'succeeded', outPath, [row], null)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}

/** True when the engine runs as root, where Chrome will not start sandboxed. */
function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

/**
 * python_script: write the interpolated script to the evidence dir and run it
 * with python3. Placeholders belong inside a string literal (`"{{ target.value }}"`).
 */
export async function runPythonScript(
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
  const raw = String(node.data.script ?? '')
  if (raw.trim() === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no script provided', [], null)
    return
  }
  // A target, a loop item or a tool's output is attacker-shaped text. It goes
  // into the script escaped as string-literal content, so a value can supply
  // data but can never close a quote and become code.
  const script = interpolate(raw, ctx, escapePythonString) ?? raw
  const dir = deps.project.evidenceDir(executionId)
  const scriptPath = `${dir}/${node.id}.py`
  const timeoutMs = Math.min(Math.max(1000, Number(node.data.timeout ?? 60000)), 600000)
  try {
    writeFileSync(scriptPath, script)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', `could not write script: ${String((e as Error).message)}`, [], null)
    return
  }
  const python = findPythonBinary()
  if (python === null) {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no python3/python interpreter found', [], null)
    return
  }
  try {
    const result = await spawnCapture(python, [scriptPath], timeoutMs)
    const stdout = result.stdout
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, stdout)
    // spawnCapture collects stderr; without this it was dropped on the floor, so
    // a script diagnosing itself with print(..., file=sys.stderr) said nothing.
    const stderrPath = writeBuiltinStderr(deps.project, executionId, node.id, result.stderr)
    let rows: Array<Record<string, unknown>> = []
    const trimmed = stdout.trim()
    const lastLine = trimmed.split('\n').filter((l) => l.trim() !== '').pop() ?? ''
    for (const candidate of [trimmed, lastLine]) {
      if (candidate === '') continue
      try {
        const parsed = JSON.parse(candidate)
        rows = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [parsed as Record<string, unknown>]
        break
      } catch {
        /* not JSON */
      }
    }
    if (rows.length === 0) rows = [{ raw_output: stdout }]
    if (target !== undefined) {
      deps.project.facts.record({
        targetId: target.id,
        kind: 'raw_output',
        executionId,
        nodeId: node.id,
        data: { output: stdout, exit_code: result.code },
      })
    }
    nodeOutputs[node.id] = { output: stdout, rows }
    finishBuiltin(
      deps,
      executionId,
      node.id,
      result.code === 0 ? 'succeeded' : 'failed',
      stdout,
      rows,
      stdoutPath,
      stderrPath,
    )
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
}
