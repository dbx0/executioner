import type { JSX } from 'react'
import { cn } from '../lib/utils.js'
import { openWhatsNew } from '../lib/whats-new.js'

/**
 * The app version, and nothing else. Clicking it opens the what's-new notes.
 * It sits at the foot of the Settings nav and in a corner of the landing page.
 */
export function VersionButton({ className }: { className?: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={openWhatsNew}
      aria-label={`Version ${__APP_VERSION__}, see what is new`}
      className={cn(
        'app-no-drag inline-flex h-6 shrink-0 items-center rounded-control px-2.5 text-[11px] tabular-nums text-tertiary-foreground outline-none transition-colors',
        'hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      v{__APP_VERSION__}
    </button>
  )
}
