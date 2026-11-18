import type { JSX, ReactNode } from 'react'
import { stagger } from '../../lib/motion.js'

export const FIELD_LABEL_CLASS = 'text-xs font-semibold text-muted-foreground'

/** One staggered entrance step. FindingDetail is keyed by finding id, so this replays per selection only. */
export function Step({ index, children }: { index: number; children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0 motion-safe:animate-enter" style={stagger(index, 120)}>
      {children}
    </div>
  )
}

/**
 * One captioned section of the finding card, with an optional control pinned to
 * the right of the caption. A plain block rather than a `<label>`: a button
 * inside a label forwards its clicks to the first control, which would put the
 * caret in the textarea every time you reached for the action.
 */
export function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <div className="flex h-5 items-center gap-2">
        <h2 className={FIELD_LABEL_CLASS}>{label}</h2>
        {action !== undefined && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}
