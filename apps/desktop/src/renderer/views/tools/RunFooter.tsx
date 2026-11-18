import type { JSX, RefObject } from 'react'
import { Download, Play } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'

/** How the run shortcut reads on this platform. */
const RUN_SHORTCUT = /Mac/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl+Enter'

/**
 * The form's action row: Run (or Install, when the tool is not on the chosen
 * connection), the reason Run is blocked, and where the run will go.
 */
export function RunFooter({
  program,
  missing,
  blocked,
  starting,
  targetCount,
  reason,
  isError,
  onFocusNeeded,
  onRun,
  onInstall,
  runRef,
  runsOn,
}: {
  /** The tool's binary, for the Install button. */
  program: string
  missing: boolean
  blocked: boolean
  starting: boolean
  targetCount: number
  /** Why Run is blocked or why the last one failed; null when there is nothing to say. */
  reason: string | null
  /** The reason is a failed start, announced as an alert. */
  isError: boolean
  /** Take the user to the field the reason is about, when it is about one. */
  onFocusNeeded: (() => void) | null
  onRun: () => void
  onInstall: () => void
  runRef?: RefObject<HTMLButtonElement | null> | undefined
  runsOn: string
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-glass-border px-4 py-3">
      {missing ? (
        <Button variant="glass" size="sm" onClick={onInstall}>
          <Download className="size-3.5" /> Install {program}
        </Button>
      ) : (
        <Tip label={`Run (${RUN_SHORTCUT})`} side="top">
          <Button ref={runRef} size="sm" disabled={blocked || starting} onClick={onRun}>
            {starting ? <Spinner size="sm" /> : <Play className="size-3.5" />}
            {targetCount > 1 ? `Run on ${targetCount} targets` : 'Run'}
          </Button>
        </Tip>
      )}
      {reason !== null && onFocusNeeded !== null ? (
        <button
          type="button"
          onClick={onFocusNeeded}
          className="min-w-0 truncate rounded-control text-left text-[12px] text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title={reason}
        >
          {reason}
        </button>
      ) : (
        reason !== null && (
          <span
            role={isError ? 'alert' : undefined}
            className={cn('min-w-0 truncate text-[12px]', isError ? 'text-status-error' : 'text-muted-foreground')}
            title={reason}
          >
            {reason}
          </span>
        )
      )}
      <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">on {runsOn}</span>
    </div>
  )
}
