import type { JSX } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Checkbox } from '../ui/checkbox.js'
import { Input } from '../ui/input.js'
import { Select, type SelectOption } from '../ui/select.js'
import { Textarea } from '../ui/textarea.js'
import { NumericField } from './NumericField.js'
import { TemplateChip } from './surface.js'
import { cn } from '../../lib/utils.js'

// Re-exported from lib/param-specs so components keep importing them from here.
export { toParamSpecs, type ParamSpec } from '../../lib/param-specs.js'
import type { ParamSpec } from '../../lib/param-specs.js'

/** Default quick-insert chip; callers can extend with upstream node references. */
const DEFAULT_CHIPS = ['{{ target.value }}']

function FieldShell({
  param,
  children,
}: {
  param: ParamSpec
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <span className="flex items-center gap-1 font-medium">
        {param.label ?? param.name}
        {param.required === true && <span className="text-status-error">*</span>}
      </span>
      {param.warning !== undefined && (
        <div className="flex items-start gap-1.5 rounded-[10px] border border-status-error/40 bg-status-error/10 px-2.5 py-1.5 text-[11px] text-status-error">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{param.warning}</span>
        </div>
      )}
      {children}
      {param.description !== undefined && (
        <span className="text-[11px] text-muted-foreground">{param.description}</span>
      )}
    </div>
  )
}

export function ParamDrawer({
  params,
  values,
  onChange,
  chips,
  invalid = null,
}: {
  params: ParamSpec[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  /** Quick-insert template chips (defaults to just {{ target.value }}); empty hides them. */
  chips?: string[]
  /** The param that still needs a value before a run, marked on its field; null marks none. */
  invalid?: string | null
}): JSX.Element {
  const allChips = chips ?? DEFAULT_CHIPS
  const installedAgents = useApp((s) => s.installedAgents)
  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      {params.map((param) => {
        const current = values[param.name] ?? param.default ?? ''
        const needed = invalid === param.name
        const neededHint = needed ? <span className="text-[11px] text-destructive">Required to run.</span> : null

        if (param.oneOf !== undefined) {
          const isAgent = param.name === 'agent'
          // For the agent picker, offer only agents whose CLI is installed (once
          // that machine-wide check has resolved); keep the node's current value.
          const oneOf =
            isAgent && installedAgents !== null
              ? param.oneOf.filter((o) => installedAgents.includes(String(o)) || String(o) === String(current))
              : param.oneOf
          const options: SelectOption[] = oneOf.map((opt) => {
            const v = String(opt)
            const option: SelectOption = {
              value: v,
              label: isAgent ? `${v.charAt(0).toUpperCase()}${v.slice(1)}` : v,
            }
            if (isAgent) option.icon = <AgentIcon agent={v} className="size-4" />
            return option
          })
          return (
            <FieldShell key={param.name} param={param}>
              <Select
                ariaLabel={param.name}
                value={String(current)}
                onValueChange={(v) => onChange(param.name, v)}
                options={options}
              />
              {neededHint}
            </FieldShell>
          )
        }

        if (param.type === 'boolean') {
          return (
            <label key={param.name} className="flex items-start gap-2 text-[13px]">
              <Checkbox
                aria-label={param.name}
                className="mt-0.5"
                checked={Boolean(current)}
                onCheckedChange={(checked) => onChange(param.name, checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span>{param.label ?? param.name}</span>
                {param.description !== undefined && (
                  <span className="text-[11px] text-muted-foreground">{param.description}</span>
                )}
              </span>
            </label>
          )
        }

        const isTextarea = param.type === 'string' && (param.ui === 'textarea' || param.ui === 'code')
        const insertChip = (chip: string): void =>
          onChange(param.name, `${String(current)}${String(current) === '' ? '' : ' '}${chip}`)

        return (
          <FieldShell key={param.name} param={param}>
            {isTextarea ? (
              <Textarea
                aria-label={param.name}
                aria-invalid={needed || undefined}
                rows={param.ui === 'code' ? 8 : 3}
                value={String(current)}
                placeholder={param.placeholder}
                onChange={(e) => onChange(param.name, e.target.value)}
                className={cn('resize-y text-[13px]', param.ui === 'code' && 'font-mono text-[12px]', needed && 'border-destructive')}
              />
            ) : param.type === 'number' ? (
              <NumericField
                aria-label={param.name}
                value={current === '' ? undefined : Number(current)}
                // An emptied field has always stored 0 for a number param.
                emptyAs={0}
                onChange={(n) => onChange(param.name, n)}
                className={cn('h-8 text-[13px]', needed && 'border-destructive')}
                {...(param.placeholder === undefined ? {} : { placeholder: param.placeholder })}
              />
            ) : (
              <Input
                aria-label={param.name}
                aria-invalid={needed || undefined}
                type="text"
                value={String(current)}
                placeholder={param.placeholder}
                onChange={(e) => onChange(param.name, e.target.value)}
                className={cn('h-8 text-[13px]', needed && 'border-destructive')}
              />
            )}
            {neededHint}
            {param.type === 'string' && allChips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allChips.map((chip) => (
                  <TemplateChip key={chip} chip={chip} onInsert={insertChip} />
                ))}
              </div>
            )}
          </FieldShell>
        )
      })}
    </div>
  )
}
