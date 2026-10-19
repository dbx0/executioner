import type { JSX } from 'react'
import { Users } from 'lucide-react'
import { cn } from '../../lib/utils.js'

/**
 * The Claude Agent Team mark: a small "users" glyph in `currentColor` so it
 * inherits the surrounding near-monochrome text color, distinguishing a team
 * launch from a single Claude session in the spawn menu and tab strip. A new,
 * self-contained component (the shared AgentIcon is owned elsewhere).
 */
export function TeamIcon({ className }: { className?: string }): JSX.Element {
  return <Users className={cn('size-4', className)} strokeWidth={1.75} aria-hidden />
}
