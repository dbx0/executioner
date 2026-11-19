import type { JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, FolderOpen, FolderPlus } from 'lucide-react'
import { Button } from '../ui/button.js'
import { DialogBody, DialogFooter } from '../ui/dialog.js'
import { Spinner } from '../ui/spinner.js'
import { cn } from '../../lib/utils.js'

/** The surface every wizard tile shares: a glass card that brightens when chosen. */
const CARD =
  'rounded-[14px] border border-glass-border text-left outline-none transition-colors ' +
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45'

/**
 * A tile that picks one option of a step (an agent, a theme, an execution
 * mode). It is a pressed-state button, so the choice is announced.
 */
export function ChoiceCard({
  selected,
  disabled = false,
  onSelect,
  className,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(CARD, selected ? 'bg-glass-active' : 'bg-glass hover:bg-glass-strong disabled:hover:bg-glass', className)}
    >
      {children}
    </button>
  )
}

/** The round check that marks the chosen tile. */
export function SelectedMark({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn('grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground', className)}>
      <Check aria-hidden className="size-2.5" strokeWidth={3} />
    </span>
  )
}

/** The square icon well at the start of a row tile. */
export function IconWell({ icon: Icon }: { icon: LucideIcon }): JSX.Element {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-glass-strong">
      <Icon aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
    </span>
  )
}

/** A row tile's title over its one-line description. */
export function TileText({ title, blurb }: { title: string; blurb: string }): JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] font-medium">{title}</div>
      <div className="text-[11.5px] text-muted-foreground">{blurb}</div>
    </div>
  )
}

function LaunchTile({
  icon,
  title,
  blurb,
  disabled,
  onClick,
  trailing,
}: {
  icon: LucideIcon
  title: string
  blurb: string
  disabled: boolean
  onClick: () => void
  trailing?: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(CARD, 'flex items-center gap-3 bg-glass p-4 hover:bg-glass-strong disabled:hover:bg-glass')}
    >
      <IconWell icon={icon} />
      <TileText title={title} blurb={blurb} />
      {trailing}
    </button>
  )
}

/**
 * The two ways into an engagement, shared by the local flow's last step and the
 * backend flow's save step. Both go quiet while a folder is being opened.
 */
export function EngagementChoices({
  busy,
  onOpen,
}: {
  busy: boolean
  /** `create` is false for "Open engagement", true for "New engagement". */
  onOpen: (create: boolean) => void
}): JSX.Element {
  return (
    <>
      <LaunchTile
        icon={FolderOpen}
        title="Open engagement"
        blurb="Pick an existing engagement folder."
        disabled={busy}
        onClick={() => onOpen(false)}
      />
      <LaunchTile
        icon={FolderPlus}
        title="New engagement"
        blurb="Create a fresh engagement in a new folder."
        disabled={busy}
        onClick={() => onOpen(true)}
        trailing={busy ? <Spinner className="text-muted-foreground" /> : undefined}
      />
    </>
  )
}

/** The scrolling body of a wizard step. */
export function StepBody({ children }: { children: ReactNode }): JSX.Element {
  return <DialogBody className="p-5">{children}</DialogBody>
}

/** A quiet status beside the footer buttons while something is in flight. */
export function FooterStatus({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <Spinner />
      {children}
    </span>
  )
}

/**
 * The wizard's footer: Skip on the left, the progress dots in the middle and
 * the step's own buttons on the right. Every step renders it, so the three
 * never shift between steps.
 */
export function WizardFooter({
  dots,
  onSkip,
  children,
}: {
  dots: ReactNode
  onSkip: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <DialogFooter className="justify-start">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={onSkip}>
        Skip setup
      </Button>
      <div aria-hidden className="mx-auto flex items-center gap-1.5">
        {dots}
      </div>
      {children}
    </DialogFooter>
  )
}
