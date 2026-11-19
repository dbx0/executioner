import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Pin, Columns2 } from 'lucide-react'
import { useApp, type ActiveTab } from '../../store.js'
import { Input } from '../../components/ui/input.js'
import { ConfirmModal } from '../../components/modals/ConfirmModal.js'
import { ITEM_DRAG_TYPE } from '../../lib/pane-tree.js'
import { cn } from '../../lib/utils.js'
import { segmentClass } from '../../components/ui/segmented.js'
import { WorkspaceTabMenu } from './WorkspaceTabMenu.js'

/**
 * One tab in the unified strip: a pill inside the strip's capsule, standing for
 * a terminal, a file or a browser. Double-clicking the title turns it into an
 * inline rename field (Enter/blur commits, Escape cancels). The status dot
 * follows the title; the close affordance comes last.
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
  split = false,
  bare = false,
  onSplit,
  onMovePaneOut,
  confirmClose,
  onCloseAll,
  confirmCloseAll,
  confirmBulk,
  menuExtra,
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
  /** The tab holds more than one pane: show the split icon. */
  split?: boolean | undefined
  /** A layout holding only empty panes: no item to rename, pin, colour or anchor a bulk close on. */
  bare?: boolean | undefined
  /** Split the tab's focused pane; the new pane starts as a picker. */
  onSplit: (dir: 'row' | 'col') => void
  /** Break the focused pane out into its own tab. Only given when the tab holds 2 or more panes. */
  onMovePaneOut?: (() => void) | undefined
  /** Ask this question before calling `onClose`. */
  confirmClose?: string | undefined
  /** Close every pane of a split tab. Only given when the tab holds 2 or more panes; `onClose` then closes the focused one. */
  onCloseAll?: (() => void) | undefined
  /** Closing every pane ends other panes' work: ask this question before calling `onCloseAll`. */
  confirmCloseAll?: string | undefined
  /** The question to ask before each bulk close, when it would end a working agent. */
  confirmBulk?: { others?: string | undefined; right?: string | undefined; left?: string | undefined } | undefined
  /** Extra menu entries for this kind of tab (a browser's hand-off), drawn above Close; `close` dismisses the menu. */
  menuExtra?: ((close: () => void) => JSX.Element) | undefined
}): JSX.Element {
  const renameTab = useApp((s) => s.renameTab)
  const renameRequest = useApp((s) => s.renameRequest)
  const clearTabRename = useApp((s) => s.clearTabRename)
  const [editing, setEditing] = useState(false)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [confirming, setConfirming] = useState<{ message: string; run: () => void } | null>(null)
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

  // Every close path (button, middle-click, menu) asks first when the layout warrants it.
  const requestClose = (): void => {
    ask(confirmClose, onClose)
  }
  const ask = (message: string | undefined, run: () => void): void => {
    if (message === undefined) run()
    else setConfirming({ message, run })
  }

  return (
    <div
      draggable={!bare && !editing}
      onDragStart={(e) => {
        // The tab stands for its focused item; dropping it on a pane edge moves that item there.
        e.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify({ kind: tab.kind, id: tab.id }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onSelect}
      onMouseDown={(e) => {
        // Middle-click closes the tab (prevent the OS autoscroll cursor) — but a
        // pinned tab is protected.
        if (e.button === 1) {
          e.preventDefault()
          if (!pinned) requestClose()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuPos({ x: e.clientX, y: e.clientY })
      }}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onKeyDown={(e) => {
        // Enter or Space on the pill itself selects it; keys typed in the rename field stay there.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(segmentClass(active), 'group h-7 cursor-pointer gap-2 pl-2.5 pr-1.5 text-xs')}
    >
      {pinned && <Pin className="size-3 shrink-0 fill-current text-muted-foreground" strokeWidth={1.75} aria-label="Pinned" />}
      {icon}
      {split && <Columns2 className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-label="Split tab" />}
      {/* The user's own color label for the tab: a stored value, so it is set inline. */}
      {color !== undefined && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {editing ? (
        <Input
          autoFocus
          defaultValue={title}
          spellCheck={false}
          aria-label="Tab title"
          className="h-5 w-[14ch] min-w-[80px] max-w-[160px] px-2 py-0 text-xs"
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
            else if (!bare) startRename()
          }}
        >
          {title}
        </span>
      )}
      {statusDot}
      {/* Pinned tabs are protected from close, so they show no close affordance. */}
      {pinned ? (
        <span className="w-1" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            requestClose()
          }}
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-glass-active hover:text-foreground',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
            // A clean tab keeps the slot but only shows the X on hover, focus or when active.
            dirty || active ? 'text-muted-foreground' : 'text-transparent focus-visible:text-muted-foreground group-hover:text-muted-foreground',
          )}
          aria-label={dirty ? 'Close tab (unsaved changes)' : 'Close tab'}
        >
          {/* A dirty tab shows a dot that turns into the close button on hover. */}
          {dirty && <span className="size-2 rounded-full bg-muted-foreground group-hover:hidden" aria-hidden />}
          <X className={cn('size-3', dirty && 'hidden group-hover:block')} />
        </button>
      )}
      {confirming !== null &&
        createPortal(
          // A portal keeps the tab's hover styles off the modal; React events still bubble to the tab, so stop them.
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onDragStart={(e) => e.stopPropagation()}
          >
            <ConfirmModal
              title="Close tab"
              message={confirming.message}
              confirmLabel="Close all"
              destructive
              onCancel={() => setConfirming(null)}
              onConfirm={() => {
                setConfirming(null)
                confirming.run()
              }}
            />
          </div>,
          document.body,
        )}
      {menuPos !== null && (
        <WorkspaceTabMenu
          x={menuPos.x}
          y={menuPos.y}
          onDismiss={() => setMenuPos(null)}
          pinned={pinned}
          color={color}
          split={split}
          bare={bare}
          filePath={filePath}
          canCloseOthers={canCloseOthers}
          canCloseToRight={canCloseToRight}
          canCloseToLeft={canCloseToLeft}
          onTogglePin={onTogglePin}
          onSplit={onSplit}
          onMovePaneOut={onMovePaneOut}
          onClose={requestClose}
          onCloseAll={onCloseAll === undefined ? undefined : () => ask(confirmCloseAll, onCloseAll)}
          onCloseOthers={() => ask(confirmBulk?.others, onCloseOthers)}
          onCloseToRight={() => ask(confirmBulk?.right, onCloseToRight)}
          onCloseToLeft={() => ask(confirmBulk?.left, onCloseToLeft)}
          onRename={startRename}
          onSetColor={onSetColor}
          menuExtra={menuExtra}
        />
      )}
    </div>
  )
}
