import { setFlagsFromString } from 'node:v8'

const LINEAR_REGEX_FLAG = '--enable-experimental-regexp-engine'
const LINEAR_FLAG = 'l'

/** Whether this process can already compile a regex with the linear-time `l` flag. */
function linearRegexSupported(): boolean {
  try {
    new RegExp('', LINEAR_FLAG)
    return true
  } catch {
    return false
  }
}

/**
 * Turn on V8's linear-time regex engine (the `l` flag) unless the process
 * started with it. The desktop app passes the flag on the engine's command
 * line: changing a V8 flag at runtime makes Electron's Node abort as soon as a
 * Worker starts, and on Windows node-pty starts one for every terminal. A plain
 * Node run (the CLI, tests) has no Workers there, so setting it here is safe.
 */
export function enableLinearRegex(
  deps: { supported: () => boolean; setFlags: (flags: string) => void } = {
    supported: linearRegexSupported,
    setFlags: setFlagsFromString,
  }
): void {
  if (!deps.supported()) deps.setFlags(LINEAR_REGEX_FLAG)
}

/**
 * An IF condition's `new RegExp(...)` pattern can come from an imported workflow
 * or a templated tool output, and a backtracking engine lets one such pattern
 * pin the engine for minutes; the condition evaluator in @exe/graph compiles
 * every pattern with `l`, and refuses regex conditions when this was never
 * enabled.
 *
 * The flag only makes the `l` flag parseable, so turning it on changes nothing
 * for any other regex in the process. Importing this module is enough.
 */
enableLinearRegex()
