import type { JSX } from 'react'
import { X, Pin, PinOff, Pencil } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { TabMenuItem, TabMenuSeparator, TabMenuSurface } from './TabMenu.js'

/**
 * The tab-color swatches: a "none" option plus eight accent colors. These are
 * the user's own labels for a tab, stored with it, so they are fixed values
 * rather than theme tokens.
 */
const TAB_COLORS: { label: string; value: string | undefined }[] = [
  { label: 'None', value: undefined },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Teal', value: '#14b8a6' },
]

/** The keyboard-shortcut modifier glyph for the current platform (⌘ on mac, Ctrl elsewhere). */
const MOD = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl'

export interface WorkspaceTabMenuProps {
  x: number
  y: number
  /** Dismiss the menu. Every entry dismisses before it acts. */
  onDismiss: () => void
  pinned: boolean
  color: string | undefined
  split: boolean
  /** A layout holding only empty panes: no item to rename, pin, colour or anchor a bulk close on. */
  bare: boolean
  filePath?: string | undefined
  canCloseOthers: boolean
  canCloseToRight: boolean
  canCloseToLeft: boolean
  onTogglePin: () => void
  onSplit: (dir: 'row' | 'col') => void
  onMovePaneOut?: (() => void) | undefined
  onClose: () => void
  onCloseAll?: (() => void) | undefined
  onCloseOthers: () => void
  onCloseToRight: () => void
  onCloseToLeft: () => void
  onRename: () => void
  onSetColor: (color: string | undefined) => void
  /** Extra entries for this kind of tab (a browser's hand-off), drawn above Close. */
  menuExtra?: ((close: () => void) => JSX.Element) | undefined
}

/** The right-click menu of a tab in the strip. */
export function WorkspaceTabMenu(props: WorkspaceTabMenuProps): JSX.Element {
  const { pinned, color, split, bare, filePath, onDismiss } = props
  const run = (fn: () => void) => (): void => {
    onDismiss()
    fn()
  }
  return (
    <TabMenuSurface x={props.x} y={props.y} onClose={onDismiss}>
      {!bare && (
        <>
          <TabMenuItem
            icon={pinned ? <PinOff className="size-3.5 shrink-0" /> : <Pin className="size-3.5 shrink-0" />}
            onClick={run(props.onTogglePin)}
          >
            {pinned ? 'Unpin Tab' : 'Pin Tab'}
          </TabMenuItem>
          <TabMenuSeparator />
          <TabMenuItem onClick={run(() => props.onSplit('row'))}>Split right</TabMenuItem>
          <TabMenuItem onClick={run(() => props.onSplit('col'))}>Split down</TabMenuItem>
          {props.onMovePaneOut !== undefined && <TabMenuItem onClick={run(props.onMovePaneOut)}>Move pane to new tab</TabMenuItem>}
          <TabMenuSeparator />
        </>
      )}
      {props.menuExtra !== undefined && (
        <>
          {props.menuExtra(onDismiss)}
          <TabMenuSeparator />
        </>
      )}
      <TabMenuItem icon={<X className="size-3.5 shrink-0" />} shortcut={`${MOD}W`} disabled={pinned} onClick={run(props.onClose)}>
        {split ? 'Close pane' : 'Close'}
      </TabMenuItem>
      {props.onCloseAll !== undefined && (
        <TabMenuItem disabled={pinned} onClick={run(props.onCloseAll)}>
          Close all panes
        </TabMenuItem>
      )}
      {!bare && (
        <>
          <TabMenuItem disabled={!props.canCloseOthers} onClick={run(props.onCloseOthers)}>
            Close Others
          </TabMenuItem>
          <TabMenuItem disabled={!props.canCloseToRight} onClick={run(props.onCloseToRight)}>
            Close Tabs To The Right
          </TabMenuItem>
          <TabMenuItem disabled={!props.canCloseToLeft} onClick={run(props.onCloseToLeft)}>
            Close Tabs To The Left
          </TabMenuItem>
          <TabMenuSeparator />
          <TabMenuItem icon={<Pencil className="size-3.5 shrink-0" />} shortcut={`${MOD}R`} onClick={run(props.onRename)}>
            Change Title
          </TabMenuItem>
          <div className="px-2.5 pb-1 pt-1.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Tab Color</div>
            <div role="radiogroup" aria-label="Tab color" className="flex flex-wrap gap-2">
              {TAB_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  role="radio"
                  aria-checked={color === c.value}
                  aria-label={c.label}
                  onClick={run(() => props.onSetColor(c.value))}
                  className={cn(
                    'relative size-4 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    c.value !== undefined ? 'border-transparent' : 'border-border-strong bg-transparent',
                    color === c.value && 'ring-1 ring-border-strong ring-offset-1 ring-offset-popover',
                  )}
                  // The swatch shows the stored color itself.
                  style={c.value !== undefined ? { backgroundColor: c.value } : undefined}
                >
                  {c.value === undefined && (
                    <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-tertiary-foreground" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {filePath !== undefined && (
        <>
          <TabMenuSeparator />
          <TabMenuItem onClick={run(() => void navigator.clipboard?.writeText(filePath))}>Copy Path</TabMenuItem>
        </>
      )}
    </TabMenuSurface>
  )
}
