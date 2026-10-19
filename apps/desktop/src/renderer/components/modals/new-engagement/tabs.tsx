import type { JSX } from 'react'
import { FolderOpen, Plus, X } from 'lucide-react'
import { cn } from '../../../lib/utils.js'
import { Button } from '../../ui/button.js'
import { Input } from '../../ui/input.js'
import type { NormalizedTarget } from '../../../lib/target-input.js'
import type { Recent } from '../../../store/types.js'
import { TABS, TEXTAREA_CLASS, type TabId } from './constants.js'
import { FieldLabel, IdentityFields } from './fields.js'
import { RecentGrid } from './recents.js'

/** "Start with AI": identity fields plus a free-text program description and scope. */
export function AiTab(props: {
  name: string
  setName: (v: string) => void
  icon: string | undefined
  setIcon: (v: string | undefined) => void
  photo: string | undefined
  setPhoto: (v: string | undefined) => void
  dir: string | undefined
  onPickFolder: () => void
  busy: boolean
  description: string
  setDescription: (v: string) => void
  scope: string
  setScope: (v: string) => void
}): JSX.Element {
  return (
    <>
      <IdentityFields
        name={props.name}
        setName={props.setName}
        icon={props.icon}
        setIcon={props.setIcon}
        photo={props.photo}
        setPhoto={props.setPhoto}
        dir={props.dir}
        onPickFolder={props.onPickFolder}
        disabled={props.busy}
      />
      <FieldLabel>Program description</FieldLabel>
      <textarea
        className={cn(TEXTAREA_CLASS, 'mb-3')}
        rows={3}
        value={props.description}
        onChange={(e) => props.setDescription(e.target.value)}
        placeholder="What is this program? Any rules of engagement, focus areas, or notes."
      />
      <FieldLabel>Scope</FieldLabel>
      <textarea
        className={TEXTAREA_CLASS}
        rows={5}
        value={props.scope}
        onChange={(e) => props.setScope(e.target.value)}
        placeholder={'*.example.com\napi.example.com\n10.0.0.0/24'}
      />
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        Paste the scope from HackerOne/Bugcrowd/etc., or just a list of targets.
      </p>
    </>
  )
}

/** "Manual": identity fields plus a hand-entered target list. */
export function ManualTab(props: {
  name: string
  setName: (v: string) => void
  icon: string | undefined
  setIcon: (v: string | undefined) => void
  photo: string | undefined
  setPhoto: (v: string | undefined) => void
  dir: string | undefined
  onPickFolder: () => void
  busy: boolean
  description: string
  setDescription: (v: string) => void
  targetInput: string
  setTargetInput: (v: string) => void
  onAddTarget: () => void
  targets: NormalizedTarget[]
  onRemoveTarget: (t: NormalizedTarget) => void
}): JSX.Element {
  return (
    <>
      <IdentityFields
        name={props.name}
        setName={props.setName}
        icon={props.icon}
        setIcon={props.setIcon}
        photo={props.photo}
        setPhoto={props.setPhoto}
        dir={props.dir}
        onPickFolder={props.onPickFolder}
        disabled={props.busy}
      />
      <FieldLabel>Program description</FieldLabel>
      <textarea
        className={cn(TEXTAREA_CLASS, 'mb-3')}
        rows={3}
        value={props.description}
        onChange={(e) => props.setDescription(e.target.value)}
        placeholder="What is this program? Any rules of engagement, focus areas, or notes."
      />
      <FieldLabel>Targets</FieldLabel>
      <div className="flex gap-2">
        <Input
          value={props.targetInput}
          onChange={(e) => props.setTargetInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              props.onAddTarget()
            }
          }}
          placeholder="example.com, api.example.com, *.example.com…"
        />
        <Button type="button" variant="secondary" onClick={props.onAddTarget}>
          <Plus className="size-4" strokeWidth={1.75} />
          Add
        </Button>
      </div>
      {props.targets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.targets.map((t) => (
            <span
              key={`${t.kind}:${t.value}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 py-1 pl-2 pr-1 text-[12px]"
            >
              <span className="text-muted-foreground">{t.kind}</span>
              <span>{t.value}</span>
              <button
                type="button"
                aria-label={`Remove ${t.value}`}
                onClick={() => props.onRemoveTarget(t)}
                className="grid size-4 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        Wildcards add the parent domain; duplicates are ignored.
      </p>
    </>
  )
}

/** "Open existing": cards for previously opened engagements, plus a folder picker. */
export function OpenTab(props: {
  dir: string | undefined
  onPickFolder: () => void
  busy: boolean
  recents: Recent[]
  openRoots: string[]
  onSelectRecent: (root: string) => void
  onOpenRecent: (root: string) => void
}): JSX.Element {
  const browsed = props.dir !== undefined && !props.recents.some((r) => r.root === props.dir)
  return (
    <>
      {props.recents.length > 0 && (
        <div className="mb-4">
          <FieldLabel>Recent engagements</FieldLabel>
          <RecentGrid
            recents={props.recents}
            openRoots={props.openRoots}
            selected={props.dir}
            disabled={props.busy}
            onSelect={props.onSelectRecent}
            onOpen={props.onOpenRecent}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Click an engagement to select it, or double-click to open it straight away.
          </p>
        </div>
      )}

      <FieldLabel>{props.recents.length > 0 ? 'Another folder' : 'Engagement folder'}</FieldLabel>
      <Button
        type="button"
        variant="outline"
        className={cn('w-full justify-start truncate font-normal', browsed && 'border-ring')}
        onClick={props.onPickFolder}
        disabled={props.busy}
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="truncate">{browsed ? props.dir : 'Choose an existing engagement folder…'}</span>
      </Button>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        Pick a folder that already contains an Executioner engagement (a <code>.executioner</code> directory).
      </p>
    </>
  )
}

/** The mode selector shown while the modal is still on the form phase. */
export function ModeTabs(props: { tab: TabId; onSelect: (id: TabId) => void }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-5 py-2.5" role="tablist" aria-label="New engagement mode">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={props.tab === t.id}
          onClick={() => props.onSelect(t.id)}
          className={cn(
            'rounded-md px-3 py-1.5 text-[13px] transition-colors',
            props.tab === t.id
              ? 'selected-surface'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
