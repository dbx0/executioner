import type { EngineParamSpec } from '../api/nodes.js'

export interface ParamSpec {
  name: string
  type: 'string' | 'number' | 'boolean'
  default?: string | number | boolean
  oneOf?: Array<string | number>
  /** String control style. */
  ui?: 'text' | 'textarea' | 'code'
  label?: string
  description?: string
  required?: boolean
  warning?: string
  /** Example text shown inside an empty field. */
  placeholder?: string
}

/**
 * Map the engine's manifest params (a record keyed by name, with an `enum` type
 * carrying its allowed `values`) into the flat ParamSpec[] the param drawer renders,
 * preserving the original Executioner's UI hints (label/description/required/
 * warning + string control style).
 */
export function toParamSpecs(params: Record<string, EngineParamSpec>): ParamSpec[] {
  return Object.entries(params).map(([name, spec]) => {
    const base: ParamSpec =
      spec.type === 'enum'
        ? { name, type: 'string', oneOf: spec.values }
        : { name, type: spec.type === 'bool' ? 'boolean' : spec.type }
    if (spec.default !== undefined) base.default = spec.default
    if (spec.type === 'string' && spec.ui !== undefined) base.ui = spec.ui
    if (spec.label !== undefined) base.label = spec.label
    if (spec.description !== undefined) base.description = spec.description
    if (spec.required === true) base.required = true
    if (spec.warning !== undefined) base.warning = spec.warning
    if (spec.placeholder !== undefined) base.placeholder = spec.placeholder
    return base
  })
}
