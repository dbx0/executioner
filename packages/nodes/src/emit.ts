import type { EmitSpec, TargetKind, TargetFactKind } from '@exe/protocol'
import { interpolate } from './placeholders.js'

export interface EmitContext {
  target: { id: string; kind: TargetKind; value: string }
  params: Record<string, unknown>
  nodeId: string
  executionId: string
}

export interface TargetSpec {
  kind: TargetKind
  value: string
  source: string
  parentId: string | null
}

export interface FactSpec {
  targetId: string
  kind: TargetFactKind
  executionId: string
  nodeId: string
  data: Record<string, unknown>
}

export interface EmitResult {
  targets: TargetSpec[]
  facts: FactSpec[]
}

/**
 * Turn parsed records into target upserts and fact records. Placeholders resolve
 * against record, target and params. A rule whose value (or any fact field)
 * cannot resolve is skipped, not fatal: tools emit partial rows all the time.
 */
export function applyEmit(
  records: Record<string, unknown>[],
  emit: EmitSpec,
  ctx: EmitContext,
): EmitResult {
  const targets: TargetSpec[] = []
  const facts: FactSpec[] = []

  for (const record of records) {
    const base = { target: ctx.target, params: ctx.params, record }

    for (const rule of emit.targets) {
      const value = interpolate(rule.value, base)
      if (value === undefined || value === '') continue
      targets.push({
        kind: rule.kind,
        value,
        source: ctx.nodeId,
        parentId: rule.parent === 'input' ? ctx.target.id : null,
      })
    }

    for (const rule of emit.facts) {
      const data: Record<string, unknown> = {}
      let missing = false
      for (const [key, template] of Object.entries(rule.data)) {
        const resolved = interpolate(template, base)
        if (resolved === undefined) {
          missing = true
          break
        }
        data[key] = resolved
      }
      if (missing) continue
      facts.push({
        targetId: ctx.target.id,
        kind: rule.kind,
        executionId: ctx.executionId,
        nodeId: ctx.nodeId,
        data,
      })
    }
  }

  return { targets, facts }
}
