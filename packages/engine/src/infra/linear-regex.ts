import { setFlagsFromString } from 'node:v8'

/**
 * Turn on V8's linear-time regex engine (the `l` flag) for this process. An IF
 * condition's `new RegExp(...)` pattern can come from an imported workflow or a
 * templated tool output, and a backtracking engine lets one such pattern pin
 * the engine for minutes; the condition evaluator in @exe/graph compiles every
 * pattern with `l`, and refuses regex conditions when this was never enabled.
 *
 * The flag only makes the `l` flag parseable, so turning it on changes nothing
 * for any other regex in the process. Importing this module is enough.
 */
setFlagsFromString('--enable-experimental-regexp-engine')
