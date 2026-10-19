import type { JSX } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../../store.js'
import { THEMES } from '../../lib/themes.js'
import { cn } from '../../lib/utils.js'
import { PageHeading } from './parts.js'

/** Appearance: pick from the named-theme system (lib/themes.ts + index.css). */
export function AppearanceSection(): JSX.Element {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)

  return (
    <div>
      <PageHeading title="Appearance" description="Choose a theme. Your choice is saved and applied everywhere." />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {THEMES.map((t) => {
          const selected = theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              aria-pressed={selected}
              className={cn(
                'group flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
                selected
                  ? 'selected-surface border-transparent'
                  : 'border-border hover:bg-surface-1',
              )}
            >
              <div
                className="relative h-14 w-full overflow-hidden rounded-md border border-border"
                style={{ background: t.swatch.bg }}
              >
                <span
                  className="absolute left-2 top-2 h-2.5 w-10 rounded-full"
                  style={{ background: t.swatch.fg, opacity: 0.9 }}
                />
                <span
                  className="absolute left-2 top-6 h-2 w-7 rounded-full"
                  style={{ background: t.swatch.fg, opacity: 0.5 }}
                />
                {selected && (
                  <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-foreground text-background">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                )}
              </div>
              <div>
                <div className="text-[13px] font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.description}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
