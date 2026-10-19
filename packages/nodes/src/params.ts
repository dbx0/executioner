import type { ToolManifest, ParamSpec } from '@exe/protocol'

const typeMatches = (spec: ParamSpec, value: unknown): boolean => {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'bool':
      return typeof value === 'boolean'
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
  }
}

/**
 * Merge caller-provided params over declared defaults and validate each against
 * its spec. A param with no provided value and no default is required and its
 * absence throws, so a command never runs with an unresolved input.
 */
export function resolveParams(
  manifest: ToolManifest,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(manifest.params)) {
    const value = name in provided ? provided[name] : spec.default
    if (value === undefined) {
      throw new Error(`param "${name}" is required`)
    }
    if (!typeMatches(spec, value)) {
      throw new Error(`param "${name}" does not match type ${spec.type}`)
    }
    resolved[name] = value
  }
  return resolved
}
