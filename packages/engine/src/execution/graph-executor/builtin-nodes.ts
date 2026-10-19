/**
 * Barrel for the built-in (non-manifest) node handlers.
 *
 * The implementations live in `./builtin/`, grouped by what they touch:
 * `shared` (deps + the common finish path), `flow` (graph-local nodes),
 * `http` (outbound HTTP), `intel` (third-party recon APIs), `findings` (what a
 * run proved) and `system` (local subprocesses). Every symbol stays exported from this module path so
 * importers do not need to know where a handler moved.
 */
export { finishBuiltin, type BuiltinNodeDeps } from './builtin/shared.js'
export { runIf, runMerge, runSaveToTarget, runSetVariable, runTrigger } from './builtin/flow.js'
export { runSaveToFinding } from './builtin/findings.js'
export { runHttpRequest, runNotify } from './builtin/http.js'
export { runCensys, runGeoip, runShodan } from './builtin/intel.js'
export { runPythonScript, runScreenshot } from './builtin/system.js'
