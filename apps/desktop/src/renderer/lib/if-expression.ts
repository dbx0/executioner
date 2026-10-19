/**
 * Pure serializer/parser bridging the IF-condition builder UI and the engine's
 * condition language (packages/graph/src/condition.ts), a restricted
 * JavaScript-shaped expression over `data`, the last upstream node's output
 * row. So a model must serialize to an expression that language accepts and
 * that references fields as `data.<field>`.
 */

export type IfOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'regex'

export interface Condition {
  /** A data field name like "value" or a dotted path; referenced as `data.<field>`. */
  field: string
  operator: IfOperator
  value: string
}

export interface IfModel {
  conditions: Condition[]
  combinator: 'and' | 'or'
}

/** Operators that do not use the value input. */
export const VALUELESS_OPERATORS: ReadonlySet<IfOperator> = new Set<IfOperator>([
  'is_empty',
  'is_not_empty',
])

/** Human-readable labels for the operator select. */
export const OPERATOR_LABELS: Record<IfOperator, string> = {
  eq: 'equals',
  neq: 'not equals',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'greater than',
  lt: 'less than',
  gte: 'greater or equal',
  lte: 'less or equal',
  regex: 'matches regex',
}

function fieldRef(field: string): string {
  const trimmed = field.trim()
  return trimmed === '' ? 'data.value' : `data.${trimmed}`
}

function serializeCondition(cond: Condition): string {
  const ref = fieldRef(cond.field)
  const v = JSON.stringify(cond.value)
  switch (cond.operator) {
    case 'eq':
      return `${ref} === ${v}`
    case 'neq':
      return `${ref} !== ${v}`
    case 'contains':
      return `String(${ref}).includes(${v})`
    case 'not_contains':
      return `!String(${ref}).includes(${v})`
    case 'starts_with':
      return `String(${ref}).startsWith(${v})`
    case 'ends_with':
      return `String(${ref}).endsWith(${v})`
    case 'is_empty':
      return `(${ref} === undefined || ${ref} === "" || ${ref} === null)`
    case 'is_not_empty':
      return `(${ref} !== undefined && ${ref} !== "" && ${ref} !== null)`
    case 'gt':
      return `Number(${ref}) > Number(${v})`
    case 'lt':
      return `Number(${ref}) < Number(${v})`
    case 'gte':
      return `Number(${ref}) >= Number(${v})`
    case 'lte':
      return `Number(${ref}) <= Number(${v})`
    case 'regex':
      return `new RegExp(${v}).test(String(${ref}))`
    default:
      return 'false'
  }
}

/** Produce a JS boolean expression joined by `&&`/`||`. Empty list → "false". */
export function serializeIf(model: IfModel): string {
  if (model.conditions.length === 0) return 'false'
  const joiner = model.combinator === 'or' ? ' || ' : ' && '
  return model.conditions.map(serializeCondition).join(joiner)
}

const DEFAULT_CONDITION: Condition = { field: 'value', operator: 'contains', value: '' }

function defaultModel(): IfModel {
  return { conditions: [{ ...DEFAULT_CONDITION }], combinator: 'and' }
}

function parseValue(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseClause(clause: string): Condition | undefined {
  const c = clause.trim()

  let m = /^\(data\.(.+?) === undefined \|\| data\.\1 === "" \|\| data\.\1 === null\)$/.exec(c)
  if (m !== null && m[1] !== undefined) return { field: m[1], operator: 'is_empty', value: '' }

  m = /^\(data\.(.+?) !== undefined && data\.\1 !== "" && data\.\1 !== null\)$/.exec(c)
  if (m !== null && m[1] !== undefined) return { field: m[1], operator: 'is_not_empty', value: '' }

  m = /^!String\(data\.(.+?)\)\.includes\((.*)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'not_contains', value: v }
  }

  m = /^String\(data\.(.+?)\)\.includes\((.*)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'contains', value: v }
  }

  m = /^String\(data\.(.+?)\)\.startsWith\((.*)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'starts_with', value: v }
  }

  m = /^String\(data\.(.+?)\)\.endsWith\((.*)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'ends_with', value: v }
  }

  m = /^new RegExp\((.*)\)\.test\(String\(data\.(.+?)\)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[1])
    if (v !== undefined) return { field: m[2], operator: 'regex', value: v }
  }

  m = /^Number\(data\.(.+?)\) (>=|<=|>|<) Number\((.*)\)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    const op: IfOperator = m[2] === '>' ? 'gt' : m[2] === '<' ? 'lt' : m[2] === '>=' ? 'gte' : 'lte'
    const v = parseValue(m[3])
    if (v !== undefined) return { field: m[1], operator: op, value: v }
  }

  m = /^data\.(.+?) === (.*)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'eq', value: v }
  }

  m = /^data\.(.+?) !== (.*)$/.exec(c)
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const v = parseValue(m[2])
    if (v !== undefined) return { field: m[1], operator: 'neq', value: v }
  }

  return undefined
}

/**
 * Split on a top-level (depth-0) ` && ` or ` || ` separator, ignoring the same
 * tokens nested inside parentheses (as `is_empty`/`is_not_empty` emit). Returns
 * the detected combinator and the clause segments.
 */
function splitTopLevel(expression: string): { combinator: 'and' | 'or'; parts: string[] } {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let combinator: 'and' | 'or' = 'and'

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && (ch === '&' || ch === '|') && expression[i + 1] === ch) {
      // Require the ` && ` / ` || ` surrounding spaces this module emits.
      if (expression[i - 1] === ' ' && expression[i + 2] === ' ') {
        parts.push(expression.slice(start, i - 1))
        if (ch === '|') combinator = 'or'
        i += 2
        start = i + 1
      }
    }
  }
  parts.push(expression.slice(start))
  return { combinator, parts }
}

/**
 * Best-effort parse of an engine expression back into an editable model. Never
 * throws; falls back to a single default condition when the shape is unknown.
 */
export function parseIf(expression: string | undefined): IfModel {
  if (expression === undefined || expression.trim() === '') return defaultModel()

  const { combinator, parts } = splitTopLevel(expression)

  const conditions: Condition[] = []
  for (const part of parts) {
    const cond = parseClause(part)
    if (cond === undefined) return defaultModel()
    conditions.push(cond)
  }

  if (conditions.length === 0) return defaultModel()
  return { conditions, combinator }
}
