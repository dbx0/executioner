import type { JSX } from 'react'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useApp } from '../../store.js'
import type { Overview } from '../../api/overview.js'
import { stagger } from '../../lib/motion.js'
import { Button } from '../../components/ui/button.js'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { Input } from '../../components/ui/input.js'
import { Spinner } from '../../components/ui/spinner.js'
import { IconPicker } from '../../components/IconPicker.js'
import { Description } from './Description.js'
import { Hint } from './Hint.js'
import { WiredUp } from './WiredUp.js'
import { engagementAge, relativeSince, type AgentActivity } from './summary.js'

/** The name with its pencil, or the field that replaces it while renaming. The
 *  name saves on Enter, so there is no second "unsaved" state to explain. */
function EngagementName({ name, working }: { name: string; working: number }): JSX.Element {
  const updateEngagementMeta = useApp((s) => s.updateEngagementMeta)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)

  const startEditing = (): void => {
    setDraft(name)
    setEditing(true)
  }

  const commit = (): void => {
    const next = draft.trim()
    if (next === '' || next === name) {
      setEditing(false)
      return
    }
    setSaving(true)
    void updateEngagementMeta({ name: next }).finally(() => {
      setSaving(false)
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          aria-label="Engagement name"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="h-8 w-56 text-[15px]"
        />
        <Button size="sm" disabled={saving || draft.trim() === ''} onClick={commit}>
          {saving && <Spinner size="sm" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.01em]">{name}</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Rename engagement" onClick={startEditing}>
        <Pencil className="size-3.5" strokeWidth={1.75} />
      </Button>
      {working > 0 && (
        <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-control bg-[color-mix(in_srgb,var(--ai)_16%,transparent)] px-2.5 text-[11px] font-semibold text-ai">
          <span aria-hidden className="size-1.5 rounded-full bg-ai" />
          {working} working
        </span>
      )}
    </div>
  )
}

/**
 * The hero card: badge, name and folder on the left, age and backend on the
 * right, then the program's own description and a strip of quiet totals.
 *
 * The badge and the name are edited here rather than in Settings: they belong to
 * the engagement, not to the app, and this is the page that is about it. Both
 * write straight through (an emoji or photo saves on pick, the name on Enter).
 */
export function Identity({ data, agents }: { data: Overview; agents: AgentActivity }): JSX.Element {
  const { engagement } = data
  const updateEngagementMeta = useApp((s) => s.updateEngagementMeta)
  // The store is the live copy: it updates the instant a save lands, while the
  // overview payload only catches up on the next poll.
  const storedName = useApp((s) => s.engagementName)
  const icon = useApp((s) => s.engagementIcon)
  const photo = useApp((s) => s.engagementPhoto)
  const age = engagementAge(engagement.createdAt)

  return (
    <GlassPanel asChild className="shrink-0 px-5 py-[18px] motion-safe:animate-enter" style={stagger(0, 80, 100)}>
      <section>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <IconPicker
            value={{
              ...(icon !== null && icon !== '' ? { icon } : {}),
              ...(photo !== null && photo !== '' ? { photo } : {}),
            }}
            onChange={(next) => void updateEngagementMeta({ icon: next.icon ?? '', photo: next.photo ?? '' })}
            aria-label="Change engagement icon"
            className="shrink-0"
          />
          <div className="min-w-0 flex-1 basis-64">
            <EngagementName name={storedName ?? engagement.name} working={agents.working} />
            <Hint label={engagement.root}>
              <div className="truncate font-mono text-xs text-muted-foreground">{engagement.root}</div>
            </Hint>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs text-muted-foreground">
            <span>
              Started {age.started} · day {age.day}
            </span>
            <span>
              Last asset {relativeSince(data.targets.lastSeenAt)} · last finding {relativeSince(data.findings.lastAt)}
            </span>
            <span className="inline-flex h-5 items-center rounded-control border border-glass-border px-2 text-[10px] font-semibold uppercase tracking-[0.06em]">
              {engagement.defaultBackend} backend
            </span>
          </div>
        </div>
        <Description text={engagement.description} />
        <WiredUp data={data} />
      </section>
    </GlassPanel>
  )
}
