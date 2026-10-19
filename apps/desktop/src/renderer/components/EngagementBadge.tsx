import type { JSX } from 'react'
import { cn } from '../lib/utils.js'

/** Two-letter fallback for an engagement with neither a photo nor an emoji. */
export function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export interface EngagementBadgeProps {
  name: string
  /** The emoji from config.json, shown when there is no photo. */
  icon?: string | undefined
  /** The photo badge as a PNG data URL. Wins over the emoji. */
  photo?: string | undefined
  /** Box classes: size, radius and the surface the fallbacks sit on. */
  className?: string
  /** Text size for the emoji glyph. */
  emojiClass?: string
  /** Text size for the initials. */
  initialsClass?: string
  /** Shown instead of the initials when there is no badge at all. */
  fallback?: JSX.Element
}

/**
 * One engagement's identity badge, resolved the same way everywhere it appears
 * (rail, recents grid, confirmation): the stored photo first, then the emoji,
 * then the name's initials. Keeping the precedence in one place is what stops
 * the rail and the Open-existing grid from disagreeing about an engagement.
 */
export function EngagementBadge({
  name,
  icon,
  photo,
  className,
  emojiClass = 'text-[20px]',
  initialsClass = 'text-[13px] font-semibold',
  fallback,
}: EngagementBadgeProps): JSX.Element {
  const hasPhoto = photo !== undefined && photo !== ''
  const hasIcon = icon !== undefined && icon !== ''
  return (
    <span
      className={cn(
        'flex items-center justify-center overflow-hidden',
        hasPhoto ? '' : hasIcon ? emojiClass : initialsClass,
        className,
      )}
    >
      {hasPhoto ? (
        <img src={photo} alt="" aria-hidden className="size-full object-cover" draggable={false} />
      ) : hasIcon ? (
        icon
      ) : (
        (fallback ?? <>{initials(name)}</>)
      )}
    </span>
  )
}
