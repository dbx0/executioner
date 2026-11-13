import { writeFileSync } from 'node:fs'
import { escapePythonString, interpolate } from '@exe/nodes'
import type { Target } from '@exe/protocol'
import { evidenceStem, type LoopContext, type NodeOutput } from '../../../infra/template-scope.js'
import {
  findPythonBinary,
  resolveNodeTarget,
  scopeFor,
  spawnCapture,
  writeBuiltinEvidence,
  writeBuiltinStderr,
} from '../helpers.js'
import { buildRequestHeaders } from './http.js'
import { cdpScreenshot } from './screenshot-driver.js'
import { finishBuiltin, resultOwner, savesResults, type BuiltinNodeDeps } from './shared.js'

/**
 * screenshot: capture a URL with the system headless Chrome, driven over CDP so
 * requests to the target's host carry the node's `headers` (templatable like http_request's).
 * Records a `screenshot` fact. In a loop each iteration keeps its own PNG rather
 * than overwriting the one before it.
 */
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
  const named = resolveNodeTarget(node, target, ctx)
  let url = named
  if (url === '') {
    finishBuiltin(deps, executionId, node.id, 'failed', 'no target to screenshot', [], null)
    return
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  // Headers are parsed and templated exactly as http_request does, so a value
  // pulled from tool output cannot inject a second header or break the line.
  let headers: Record<string, string>
  try {
    headers = buildRequestHeaders(node.data.headers, ctx)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', (e as Error).message, [], null)
    return
  }

  const fullPage = node.data.full_page === true || node.data.full_page === 'true'
  const timeoutMs = Math.min(Math.max(5000, Number(node.data.timeout ?? 30000)), 120000)
  const dir = deps.project.evidenceDir(executionId)
  const outPath = `${dir}/${evidenceStem(node.id, loop)}.png`
  const capture = deps.captureScreenshot ?? cdpScreenshot
  try {
    const png = await capture({ url, headers, fullPage, timeoutMs })
    writeFileSync(outPath, png)
    const row: Record<string, unknown> = { url, path: outPath, full_page: fullPage }
    const owner = resultOwner(deps, node, target, named)
    if (owner !== undefined) {
      deps.project.facts.record({ targetId: owner.id, kind: 'screenshot', executionId, nodeId: node.id, data: row })
    }
    nodeOutputs[node.id] = { output: outPath, rows: [row] }
    finishBuiltin(deps, executionId, node.id, 'succeeded', outPath, [row], null)
  } catch (e) {
    finishBuiltin(deps, executionId, node.id, 'failed', String((e as Error).message), [], null)
  }
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
    const stdoutPath = writeBuiltinEvidence(deps.project, executionId, node.id, stdout, loop)
    // spawnCapture collects stderr; without this it was dropped on the floor, so
    // a script diagnosing itself with print(..., file=sys.stderr) said nothing.
    const stderrPath = writeBuiltinStderr(deps.project, executionId, node.id, result.stderr, loop)
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
    if (target !== undefined && savesResults(node)) {
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
