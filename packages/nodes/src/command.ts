import type { ToolManifest } from '@exe/protocol'
import { interpolate, resolvePath } from './placeholders.js'

export interface CommandContext {
  target: { value: string; [key: string]: unknown }
  params: Record<string, unknown>
}

export interface Argv {
  program: string
  args: string[]
}

/** Sentinel returned when a conditional/optional token contributes no argv element. */
const DROP = Symbol('drop')

/** Resolve a `root.rest` reference (e.g. `params.username`) against the command context. */
function resolveRef(ref: string, ctx: CommandContext): unknown {
  const [root, ...rest] = ref.split('.')
  const base = (ctx as unknown as Record<string, unknown>)[root as string]
  return rest.length === 0 ? base : resolvePath(base, rest.join('.'))
}

/**
 * Truthiness for conditional flag tokens: a bool is itself, a number is nonzero,
 * a string is present and not "" / "false" / "0". Mirrors how the original
 * Python nodes gate an optional flag on a provided, non-empty value.
 */
function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  // A string mirrors Python truthiness: any non-empty string is truthy (incl. "0").
  if (typeof v === 'string') return v !== ''
  return true
}

// A whole token that is a single optional value: `{{ params.x? }}` — dropped when empty.
const OPTIONAL_RE = /^\{\{\s*([a-z0-9_.]+)\s*\?\s*\}\}$/i
// A whole token conditional literal: `{{ params.x | -flag }}` or `{{ params.x == val | -flag }}`.
const CONDITIONAL_RE = /^\{\{\s*([a-z0-9_.]+)\s*(?:==\s*([^\s|]+)\s*)?\|\s*(.+?)\s*\}\}$/i

/**
 * Resolve one args token into an argv element, or DROP it. Three conditional
 * forms extend the plain `{{ ... }}` interpolation without changing its strict
 * semantics (a plain token with an unresolved placeholder still throws):
 *   - `{{ params.x? }}`            optional value: dropped when unset/empty
 *   - `{{ params.x | -flag }}`     literal flag emitted only when x is truthy
 *   - `{{ params.x == v | -flag }} literal flag emitted only when x equals v
 */
function resolveToken(token: string, ctx: CommandContext): string | typeof DROP {
  const optional = OPTIONAL_RE.exec(token)
  if (optional) {
    const value = resolveRef(optional[1] as string, ctx)
    // Mirror the originals' `if value:` gate: an empty/zero/false value drops out.
    if (!isTruthy(value)) return DROP
    return String(value)
  }

  const conditional = CONDITIONAL_RE.exec(token)
  if (conditional) {
    const [, ref, equals, literal] = conditional
    const value = resolveRef(ref as string, ctx)
    const keep = equals !== undefined ? String(value) === equals : isTruthy(value)
    return keep ? (literal as string) : DROP
  }

  const resolved = interpolate(token, { target: ctx.target, params: ctx.params })
  if (resolved === undefined) {
    throw new Error(`command token "${token}" has an unresolved placeholder`)
  }
  return resolved
}

/**
 * Resolve a manifest's command into an argv array. Each declared token becomes
 * at most one argv element: there is no shell and no word splitting, so a target
 * value can never inject a second command. It cannot pose as a flag either, but
 * that is the asset canonicaliser's doing (no stored hostname starts with '-'),
 * not this function's: a param is passed through as typed. Optional and conditional
 * tokens (see resolveToken) may drop out; a plain token with an unresolved
 * placeholder throws, since a command cannot run half-specified.
 */
export function buildArgv(manifest: ToolManifest, ctx: CommandContext): Argv {
  const args: string[] = []
  for (const token of manifest.command.args) {
    const resolved = resolveToken(token, ctx)
    if (resolved !== DROP) args.push(resolved)
  }
  return { program: manifest.command.program, args }
}
