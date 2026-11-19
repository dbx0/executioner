import type { JSX } from 'react'
import { Settings } from 'lucide-react'
import { useApp } from '../../store.js'
import { cn } from '../../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import { UsageMeter } from './UsageMeter.js'
import { useVerboseLogging } from './useVerboseLogging.js'

/**
 * The sidebar footer, a dark inset card that took over what the bottom status
 * strip carried: the account usage meter (only with an engine to ask) beside
 * Settings (a full page, not a nav item), then the verbose-logging warning
 * while it is on. The app version lives at the foot of the Settings nav.
 */
export function SidebarFooter(): JSX.Element {
  const active = useApp((s) => s.activeView === 'settings')
  const hasEngagement = useApp((s) => s.connection !== null)
  const hasEngine = useApp((s) => s.client !== null)
  const setActiveView = useApp((s) => s.setActiveView)
  // Verbose logging shows plainly so it is not left on by accident.
  const verbose = useVerboseLogging()

  return (
    <div className="m-1.5 flex shrink-0 flex-col gap-1.5 rounded-[13px] bg-[color-mix(in_srgb,var(--background)_45%,transparent)] py-2 pl-3 pr-2">
      <div className="flex items-center gap-2.5">
        {hasEngine && <UsageMeter />}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              aria-label="Settings"
              disabled={!hasEngagement}
              onClick={() => setActiveView('settings')}
              className={cn(
                'ml-auto grid size-7 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
                active ? 'bg-glass-active text-foreground' : 'bg-glass-strong text-muted-foreground hover:bg-glass-active hover:text-foreground',
              )}
            >
              <Settings className="size-3.5" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>
      </div>
      {verbose && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="min-w-0 self-start truncate rounded-[6px] text-[11px] text-attention outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Verbose logging
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">Verbose logging is on. Turn it off in Settings, Logs.</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
