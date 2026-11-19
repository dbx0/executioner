import type { JSX } from 'react'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Switch } from '../../components/ui/switch.js'
import type { Skill } from '../../api/skills.js'
import { IconTile, SettingsCard } from './parts.js'

/** One agent activation row: brand mark, name, hint, and a Switch. */
export function AgentRow({
  id,
  name,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  id: string
  name: string
  hint: string
  checked: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-glass-border py-3 last:border-b-0">
      <IconTile size="sm">
        <AgentIcon agent={id} className="size-[18px]" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{name}</div>
        <div className="text-[11.5px] text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onToggle} aria-label={`Enable skills for ${name}`} />
    </div>
  )
}

/** One skill row: bold title, one-line description, muted mono path below. */
export function SkillRow({ skill }: { skill: Skill }): JSX.Element {
  return (
    <div className="border-b border-glass-border px-3.5 py-2.5 last:border-b-0">
      <div className="text-[13px] font-semibold">{skill.name}</div>
      {skill.description !== '' && (
        <div className="truncate text-xs text-muted-foreground">{skill.description}</div>
      )}
      <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">{skill.path}</div>
    </div>
  )
}

/** The discovered-skills card while the folder scan is in flight, in the row shape it resolves to. */
export function SkillListSkeleton(): JSX.Element {
  return (
    <SettingsCard>
      <div role="status" aria-label="Scanning skills folder">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5 border-b border-glass-border px-3.5 py-2.5 last:border-b-0">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
