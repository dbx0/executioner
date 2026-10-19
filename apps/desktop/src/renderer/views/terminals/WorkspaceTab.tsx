import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Pin, PinOff, Pencil } from 'lucide-react'
import { useApp, type ActiveTab } from '../../store.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import { TabMenuItem, TabMenuSeparator } from './TabMenu.js'

/** The tab-color swatches: a "none" option plus eight accent colors. */
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

/**
 * One tab in the unified strip — a terminal or a file. Double-clicking the title
 * turns it into an inline rename field (Enter/blur commits, Escape cancels),
 * The optional status dot is used for terminals.
 */
export function WorkspaceTab({
  tab,
  title,
  active,
  icon,
  statusDot,
  pinned,
  color,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  canCloseOthers,
  canCloseToRight,
  canCloseToLeft,
  onTogglePin,
  onSetColor,
  filePath,
  preview = false,
  dirty = false,
  onPromote,
}: {
  tab: ActiveTab
  title: string
  active: boolean
  icon?: JSX.Element | undefined
  statusDot?: JSX.Element | undefined
  pinned: boolean
  color: string | undefined
  onSelect: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToRight: () => void
  onCloseToLeft: () => void
  canCloseOthers: boolean
  canCloseToRight: boolean
  canCloseToLeft: boolean
  onTogglePin: () => void
  onSetColor: (color: string | undefined) => void
  filePath?: string | undefined
  /** A preview (ephemeral) file tab: rendered italic; double-click promotes it. */
  preview?: boolean | undefined
  /** The file has unsaved edits: show a dirty dot in place of the close affordance. */
  dirty?: boolean | undefined
  /** Promote a preview tab to permanent (double-click). */
  onPromote?: (() => void) | undefined
}): JSX.Element {
  const renameTab = useApp((s) => s.renameTab)
  const renameRequest = useApp((s) => s.renameRequest)
  const clearTabRename = useApp((s) => s.clearTabRename)
  const [editing, setEditing] = useState(false)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  // Escape unmounts the input, which still fires blur; this suppresses the
  // trailing blur-commit so a cancel cannot commit the typed value.
  const cancelled = useRef(false)

  const commit = useCallback(
    (value: string) => {
      if (cancelled.current) {
        setEditing(false)
        return
      }
      cancelled.current = true
      setEditing(false)
      renameTab(tab, value)
    },
    [renameTab, tab],
  )

  const startRename = useCallback((): void => {
    cancelled.current = false
    setEditing(true)
  }, [])

  // A global rename request (⌘R / "Change Title") targeting this tab starts the
  // inline editor here, then clears the one-shot signal.
  useEffect(() => {
    if (renameRequest !== null && renameRequest.kind === tab.kind && renameRequest.id === tab.id) {
      clearTabRename()
      startRename()
    }
  }, [renameRequest, tab.kind, tab.id, clearTabRename, startRename])

  return (
    <div
      onClick={onSelect}
      onMouseDown={(e) => {
        // Middle-click closes the tab (prevent the OS autoscroll cursor) — but a
        // pinned tab is protected.
        if (e.button === 1) {
          e.preventDefault()
          if (!pinned) onClose()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuPos({ x: e.clientX, y: e.clientY })
      }}
      className={cn(
        'group relative flex h-9 cursor-pointer items-center gap-1.5 px-3 text-xs',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {statusDot}
      {pinned && <Pin className="size-3 shrink-0 fill-current text-muted-foreground" strokeWidth={1.75} aria-label="Pinned" />}
      {icon}
      {/* A colored tab that isn't active still advertises its color with a small dot. */}
      {color !== undefined && !active && (
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      {editing ? (
        <Input
          autoFocus
          defaultValue={title}
          spellCheck={false}
          className="h-6 w-[14ch] min-w-[80px] max-w-[160px] rounded-sm px-1 py-0 text-xs shadow-none focus-visible:ring-[1px]"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(e.currentTarget.value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelled.current = true
              setEditing(false)
            }
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      ) : (
        <span
          className={cn('max-w-[160px] truncate', preview && 'italic')}
          onDoubleClick={(e) => {
            e.stopPropagation()
            // A preview tab's double-click promotes it; a permanent
            // tab's double-click renames it.
            if (preview) onPromote?.()
            else startRename()
          }}
        >
          {title}
        </span>
      )}
      {/* Pinned tabs are protected from close, so they show no close affordance. */}
      {!pinned &&
        (dirty ? (
          // A dirty tab shows a dot that turns into the close button on hover.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="ml-0.5 flex size-4 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-surface-3"
            aria-label="Close tab (unsaved changes)"
          >
            <span className="size-2 rounded-full bg-muted-foreground group-hover:hidden" aria-hidden />
            <X className="hidden size-3 group-hover:block" />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="ml-0.5 rounded p-0.5 text-transparent hover:bg-surface-3 group-hover:text-muted-foreground"
            aria-label="Close tab"
          >
            <X className="size-3" />
          </button>
        ))}
      {active && (
        <span
          className="absolute inset-x-1 bottom-0 h-0.5 rounded-full"
          style={{
            backgroundColor:
              color ?? 'color-mix(in srgb, var(--foreground) 60%, var(--card))',
          }}
        />
      )}
      {menuPos !== null && (
        <div
          className="fixed inset-0 z-[70]"
          onClick={() => setMenuPos(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenuPos(null)
          }}
        >
          <div
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[71] min-w-[192px] rounded-md border border-border bg-popover p-1 text-[13px] text-foreground shadow-floating"
          >
            <TabMenuItem
              icon={pinned ? <PinOff className="size-3.5 shrink-0" /> : <Pin className="size-3.5 shrink-0" />}
              onClick={() => { setMenuPos(null); onTogglePin() }}
            >
              {pinned ? 'Unpin Tab' : 'Pin Tab'}
            </TabMenuItem>
            <TabMenuSeparator />
            <TabMenuItem
              icon={<X className="size-3.5 shrink-0" />}
              shortcut={`${MOD}W`}
              disabled={pinned}
              onClick={() => { setMenuPos(null); onClose() }}
            >
              Close
            </TabMenuItem>
            <TabMenuItem disabled={!canCloseOthers} onClick={() => { setMenuPos(null); onCloseOthers() }}>
              Close Others
            </TabMenuItem>
            <TabMenuItem disabled={!canCloseToRight} onClick={() => { setMenuPos(null); onCloseToRight() }}>
              Close Tabs To The Right
            </TabMenuItem>
            <TabMenuItem disabled={!canCloseToLeft} onClick={() => { setMenuPos(null); onCloseToLeft() }}>
              Close Tabs To The Left
            </TabMenuItem>
            <TabMenuSeparator />
            <TabMenuItem
              icon={<Pencil className="size-3.5 shrink-0" />}
              shortcut={`${MOD}R`}
              onClick={() => { setMenuPos(null); startRename() }}
            >
              Change Title
            </TabMenuItem>
            <div className="px-2 pb-1 pt-1.5">
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Tab Color</div>
              <div className="flex flex-wrap gap-2">
                {TAB_COLORS.map((c) => {
                  const selected = color === c.value
                  return (
                    <button
                      key={c.label}
                      type="button"
                      aria-label={c.label}
                      title={c.label}
                      onClick={() => { setMenuPos(null); onSetColor(c.value) }}
                      className={cn(
                        'relative size-4 rounded-full border',
                        c.value !== undefined ? 'border-transparent' : 'border-border-strong bg-transparent',
                        selected ? 'ring-1 ring-border-strong ring-offset-1 ring-offset-popover' : '',
                      )}
                      style={c.value !== undefined ? { backgroundColor: c.value } : undefined}
                    >
                      {c.value === undefined && (
                        <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-tertiary-foreground" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            {filePath !== undefined && (
              <>
                <TabMenuSeparator />
                <TabMenuItem
                  onClick={() => {
                    setMenuPos(null)
                    void navigator.clipboard?.writeText(filePath)
                  }}
                >
                  Copy Path
                </TabMenuItem>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
