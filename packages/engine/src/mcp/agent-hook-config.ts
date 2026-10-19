import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The lifecycle hooks we ask Claude Code to report back to the engine. */
const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'Notification'] as const

/**
 * The forwarder Claude runs for each hook: it reads the hook payload on stdin
 * and POSTs it (plus this session's id and the event name) to the engine, which
 * rebroadcasts it so the desktop app can show accurate agent + sub-agent status.
 *
 * The bearer token is read from a file beside the script, never taken as an
 * argument: a process's arguments are visible to every local user through `ps`,
 * and this token opens the whole engine API.
 */
const FORWARDER = `import { readFileSync } from 'node:fs'
const [,, url, sessionId, event] = process.argv
const token = readFileSync(new URL('./token', import.meta.url), 'utf8').trim()
let data = ''
process.stdin.on('data', (c) => (data += c))
process.stdin.on('end', () => {
  let payload = {}
  try { payload = JSON.parse(data) } catch {}
  fetch(url + '/api/agent-events', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, event, payload }),
  }).catch(() => {}).finally(() => process.exit(0))
})
setTimeout(() => process.exit(0), 2000)
`

/**
 * Writes a Claude Code settings file (and its hook forwarder) so a spawned
 * agent reports its lifecycle to the engine. Returns the settings path to pass
 * via `claude --settings`.
 */
export function writeAgentHookConfig(input: {
  port: number
  token: string
  sessionId: string
  dir?: string
}): string {
  const dir = input.dir ?? mkdtempSync(join(tmpdir(), 'exe-hooks-'))
  const forwarder = join(dir, 'forward.mjs')
  writeFileSync(forwarder, FORWARDER, { mode: 0o600 })
  // Owner-only, like the directory mkdtemp made, so the token stays the user's.
  writeFileSync(join(dir, 'token'), input.token, { mode: 0o600 })

  const url = `http://127.0.0.1:${input.port}`
  // Use the engine's own node binary so the hook runs even if `node` is not on
  // the agent shell's PATH.
  const node = process.execPath
  const command = (event: string): string =>
    `${JSON.stringify(node)} ${JSON.stringify(forwarder)} ${JSON.stringify(url)} ${JSON.stringify(input.sessionId)} ${event}`

  const hooks: Record<string, unknown[]> = {}
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: command(event) }] }]
  }

  const path = join(dir, 'settings.json')
  writeFileSync(path, JSON.stringify({ hooks }, null, 2), { mode: 0o600 })
  return path
}
