import type { JSX } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Checkbox } from '../ui/checkbox.js'
import { Select, type SelectOption } from '../ui/select.js'
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
    <div className="flex flex-col gap-1 text-sm">
      <span className="flex items-center gap-1">
        {param.label ?? param.name}
        {param.required === true && <span className="text-status-error">*</span>}
      </span>
      {param.warning !== undefined && (
        <div className="flex items-start gap-1.5 rounded-md border border-status-error/40 bg-status-error/10 px-2 py-1 text-[11px] text-status-error">
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
}: {
  params: ParamSpec[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  /** Quick-insert template chips (defaults to just {{ target.value }}); empty hides them. */
  chips?: string[]
}): JSX.Element {
  const allChips = chips ?? DEFAULT_CHIPS
  const installedAgents = useApp((s) => s.installedAgents)
  const inputClass =
    'rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

  return (
    <div className="flex flex-col gap-3 p-4">
      {params.map((param) => {
        const current = values[param.name] ?? param.default ?? ''

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
            </FieldShell>
          )
        }

        if (param.type === 'boolean') {
          return (
            <label key={param.name} className="flex items-start gap-2 text-sm">
              <Checkbox
                aria-label={param.name}
                className="mt-0.5"
                checked={Boolean(current)}
                onChange={(e) => onChange(param.name, e.target.checked)}
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
              <textarea
                aria-label={param.name}
                rows={param.ui === 'code' ? 8 : 3}
                value={String(current)}
                placeholder={param.placeholder}
                onChange={(e) => onChange(param.name, e.target.value)}
                className={cn(inputClass, 'resize-y', param.ui === 'code' && 'font-mono text-[12px]')}
              />
            ) : (
              <input
                aria-label={param.name}
                type={param.type === 'number' ? 'number' : 'text'}
                value={String(current)}
                placeholder={param.placeholder}
                onChange={(e) => onChange(param.name, param.type === 'number' ? Number(e.target.value) : e.target.value)}
                className={inputClass}
              />
            )}
            {param.type === 'string' && allChips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => insertChip(chip)}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </FieldShell>
        )
      })}
    </div>
  )
}
