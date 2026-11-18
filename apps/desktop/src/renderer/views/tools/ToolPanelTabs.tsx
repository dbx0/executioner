import type { JSX, ReactNode } from 'react'
import { segmentClass } from '../../components/ui/segmented.js'
import { cn } from '../../lib/utils.js'
import { statusDot } from './run-format.js'
import type { ToolTab } from './tools-store.js'

/** One of the tool panel's two tabs: a pill inside the capsule. */
function ToolTabButton({
  tab,
  active,
  onSelect,
  tour,
  children,
}: {
  tab: ToolTab
  active: boolean
  onSelect: (tab: ToolTab) => void
  /** The page tour's anchor, when this tab is one of its stops. */
  tour?: string
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={`tools-tab-${tab}`}
      aria-controls={`tools-panel-${tab}`}
      aria-selected={active}
      data-tour={tour}
      onClick={() => onSelect(tab)}
      className={cn(segmentClass(active), 'h-[26px] px-3.5 text-xs')}
    >
      {children}
    </button>
  )
}

/**
 * The tool panel's Run / Output switch, as a capsule. The tool shows its
 * settings or its output, one at a time, so each gets the full width.
 */
export function ToolPanelTabs({
  active,
  onSelect,
  liveStatus,
}: {
  active: ToolTab
  onSelect: (tab: ToolTab) => void
  /** The watched run's status, shown as a dot on Output; null with no run. */
  liveStatus: string | null
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Tool" className="glass-capsule inline-flex h-8 shrink-0 items-center gap-0.5 self-start p-[3px]">
      <ToolTabButton tab="run" active={active === 'run'} onSelect={onSelect}>
        Run
      </ToolTabButton>
      <ToolTabButton tab="output" active={active === 'output'} onSelect={onSelect} tour="tools-output">
        {liveStatus !== null && <span aria-hidden="true" className={cn('size-1.5 rounded-full', statusDot(liveStatus))} />}
        Output
      </ToolTabButton>
    </div>
  )
}
