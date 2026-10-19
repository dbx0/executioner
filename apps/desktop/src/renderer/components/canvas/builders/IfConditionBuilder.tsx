import type { JSX } from 'react'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '../../../lib/utils.js'
import { Button } from '../../ui/button.js'
import { Select } from '../../ui/select.js'
import {
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  parseIf,
  serializeIf,
  type Condition,
  type IfModel,
  type IfOperator,
} from '../../../lib/if-expression.js'

const OPERATORS = Object.keys(OPERATOR_LABELS) as IfOperator[]

const inputClass =
  'rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function newCondition(): Condition {
  return { field: 'value', operator: 'contains', value: '' }
}

/**
 * Visual builder for an engine IF node. Edits are held in local state and
 * mirrored to the `expression` param as a serialized JS boolean expression.
 */
export function IfConditionBuilder({
  value,
  onChange,
  upstreamFields,
}: {
  value: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  upstreamFields?: string[]
}): JSX.Element {
  const [model, setModel] = useState<IfModel>(() =>
    parseIf(typeof value.expression === 'string' ? value.expression : undefined),
  )

  const commit = (next: IfModel): void => {
    setModel(next)
    onChange('expression', serializeIf(next))
  }

  const updateCondition = (index: number, patch: Partial<Condition>): void => {
    const conditions = model.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c))
    commit({ ...model, conditions })
  }

  const addCondition = (): void => {
    commit({ ...model, conditions: [...model.conditions, newCondition()] })
  }

  const removeCondition = (index: number): void => {
    if (model.conditions.length <= 1) return
    commit({ ...model, conditions: model.conditions.filter((_, i) => i !== index) })
  }

  const toggleCombinator = (): void => {
    commit({ ...model, combinator: model.combinator === 'and' ? 'or' : 'and' })
  }

  const listId = 'if-upstream-fields'
  const hasFields = upstreamFields !== undefined && upstreamFields.length > 0

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      {hasFields && (
        <datalist id={listId}>
          {upstreamFields.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      )}

      {model.conditions.map((cond, index) => {
        const showsValue = !VALUELESS_OPERATORS.has(cond.operator)
        return (
          <div key={index} className="flex flex-col gap-2">
            {index > 0 && (
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <button
                  type="button"
                  onClick={toggleCombinator}
                  className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
                >
                  {model.combinator}
                </button>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            <div className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <input
                  aria-label={`condition ${index + 1} field`}
                  type="text"
                  placeholder="field (e.g. value)"
                  value={cond.field}
                  list={hasFields ? listId : undefined}
                  onChange={(e) => updateCondition(index, { field: e.target.value })}
                  className={inputClass}
                />
                <Select
                  ariaLabel={`condition ${index + 1} operator`}
                  value={cond.operator}
                  onValueChange={(v) => updateCondition(index, { operator: v as IfOperator })}
                  options={OPERATORS.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
                />
                {showsValue && (
                  <input
                    aria-label={`condition ${index + 1} value`}
                    type="text"
                    placeholder="value"
                    value={cond.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                    className={inputClass}
                  />
                )}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`remove condition ${index + 1}`}
                disabled={model.conditions.length <= 1}
                onClick={() => removeCondition(index)}
                className="text-muted-foreground hover:text-status-error"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}

      <Button type="button" variant="outline" size="sm" onClick={addCondition} className="self-start">
        + add condition
      </Button>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Generated expression</span>
        <code
          className={cn(
            'rounded-md border border-border bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground',
            'break-all',
          )}
        >
          {serializeIf(model)}
        </code>
      </div>
    </div>
  )
}
