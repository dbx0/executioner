import type { JSX } from 'react'
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { EngagementBadge } from './EngagementBadge.js'

/** A curated palette of emojis that read well as a small engagement badge. */
const EMOJIS = [
  '🎯', '🕵️', '🛡️', '🔒', '🔓', '🗝️', '💀', '👾', '🐛', '🔥',
  '⚡', '💣', '🧨', '🚨', '📡', '🛰️', '🌐', '🖥️', '💻', '📱',
  '🔍', '🧪', '🧬', '⚙️', '🧰', '🔧', '🪝', '🎣', '🦂', '🕷️',
  '🐍', '🦈', '🐙', '🦅', '🚀', '🏴', '🏴‍☠️', '⭐', '💡', '📦',
] as const

/** The badge an engagement carries: a photo, an emoji, or neither. */
export interface IconChoice {
  icon?: string
  photo?: string
}

export interface IconPickerProps {
  value: IconChoice
  /** Called with the new badge. The two fields are exclusive: picking one
   *  clears the other, and `{}` falls back to the name's initials. */
  onChange: (value: IconChoice) => void
  className?: string
  /** Fallback glyph shown on the trigger when nothing is selected. */
  placeholder?: string
  'aria-label'?: string
}

/**
 * The engagement badge picker: a trigger showing the current photo or emoji,
 * which toggles a grid of curated glyphs plus a photo import. Selecting either
 * closes the grid; a "None" entry clears it back to initials. Pure hex/color-mix
 * tokens — no opacity utilities.
 */
export function IconPicker({
  value,
  onChange,
  className,
  placeholder = '🙂',
  'aria-label': ariaLabel = 'Choose an icon',
}: IconPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasBadge = (value.photo !== undefined && value.photo !== '') || (value.icon !== undefined && value.icon !== '')

  /** The native picker hands back a ready PNG data URL (or null if the file
   *  wasn't a readable image), so nothing unverified ever reaches the badge. */
  const pickPhoto = (): void => {
    setPicking(true)
    setError(null)
    void window.executioner
      .pickEngagementPhoto()
      .then((dataUrl) => {
        if (dataUrl === null) return
        onChange({ photo: dataUrl })
        setOpen(false)
      })
      .catch(() => setError('That image could not be read'))
      .finally(() => setPicking(false))
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'grid size-10 place-items-center overflow-hidden rounded-lg border transition-colors',
          open ? 'selected-surface border-transparent' : 'border-border hover:bg-surface-2',
        )}
      >
        {hasBadge ? (
          <EngagementBadge name="" icon={value.icon} photo={value.photo} className="size-full rounded-lg" />
        ) : (
          <span className="text-[20px] opacity-50">{placeholder}</span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Icons"
            className="absolute left-0 top-full z-50 mt-1 w-[248px] rounded-lg border border-border bg-popover p-2 shadow-floating animate-zoom-in"
          >
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="option"
                  aria-selected={value.icon === emoji}
                  onClick={() => {
                    onChange({ icon: emoji })
                    setOpen(false)
                  }}
                  className={cn(
                    'grid size-7 place-items-center rounded text-[17px] transition-colors',
                    value.icon === emoji ? 'selected-surface' : 'hover:bg-surface-3',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={pickPhoto}
              disabled={picking}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="size-3.5" strokeWidth={1.75} />
              {picking ? 'Choosing…' : 'Use a photo…'}
            </button>
            {error !== null && <p className="px-2 pb-1 text-[11.5px] text-status-error">{error}</p>}

            <button
              type="button"
              onClick={() => {
                onChange({})
                setOpen(false)
              }}
              className="w-full rounded px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              Use initials instead
            </button>
          </div>
        </>
      )}
    </div>
  )
}
