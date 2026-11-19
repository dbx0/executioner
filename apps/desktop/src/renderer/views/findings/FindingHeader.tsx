import type { JSX, ReactNode } from 'react'
import { Input } from '../../components/ui/input.js'
import { stagger } from '../../lib/motion.js'

/**
 * The open finding's title row: the title, set as the card's heading, with the
 * actions beside it. The heading is the title field itself, so renaming a
 * finding is a click on its name; the field only shows its edges on hover and
 * focus, and reads as plain heading text the rest of the time.
 */
export function FindingHeader({
  title,
  onTitleChange,
  actions,
}: {
  title: string
  onTitleChange: (title: string) => void
  actions: ReactNode
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-3 motion-safe:animate-enter" style={stagger(0, 120)}>
      <Input
        aria-label="Title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="-ml-2.5 h-10 min-w-0 flex-1 truncate rounded-xl border-transparent bg-transparent px-2.5 text-xl font-semibold tracking-[-0.01em] hover:bg-glass focus-visible:bg-glass"
      />
      {actions}
    </div>
  )
}
