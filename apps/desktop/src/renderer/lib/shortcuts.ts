export type WorkspaceShortcut =
  | { kind: 'split'; dir: 'row' | 'col' }
  | { kind: 'focus'; dir: 'left' | 'right' | 'up' | 'down' }

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** Whether the app runs on macOS, where the pane shortcuts use Cmd instead of Ctrl+Shift. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)
}

/**
 * The pane shortcut a key press stands for, or null. On macOS: Cmd+D splits right, Cmd+Shift+D
 * splits down, Cmd+Alt+Arrow moves focus. Elsewhere: Ctrl+Shift+D, Ctrl+Shift+E and Ctrl+Alt+Arrow.
 * Plain Ctrl combinations are left alone because a shell owns them (Ctrl+D is end of input).
 */
export function workspaceShortcut(e: KeyboardEvent, isMac: boolean): WorkspaceShortcut | null {
  const key = e.key.toLowerCase()
  if (isMac) {
    if (!e.metaKey || e.ctrlKey) return null
    if (e.altKey) {
      const dir = e.shiftKey ? undefined : ARROWS[e.key]
      return dir === undefined ? null : { kind: 'focus', dir }
    }
    if (key === 'd') return { kind: 'split', dir: e.shiftKey ? 'col' : 'row' }
    return null
  }
  if (!e.ctrlKey || e.metaKey) return null
  if (e.altKey) {
    const dir = e.shiftKey ? undefined : ARROWS[e.key]
    return dir === undefined ? null : { kind: 'focus', dir }
  }
  if (!e.shiftKey) return null
  if (key === 'd') return { kind: 'split', dir: 'row' }
  if (key === 'e') return { kind: 'split', dir: 'col' }
  return null
}
