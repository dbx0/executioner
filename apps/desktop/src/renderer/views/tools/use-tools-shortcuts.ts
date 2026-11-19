import { useEffect, useRef, type RefObject } from 'react'

/**
 * The page's two shortcuts. Ctrl/Cmd+Enter presses Run, so it obeys every
 * reason Run is disabled; "/" jumps to tool search unless the user is typing
 * somewhere. Both stand down while a dialog is open over the page.
 */
export function useToolsShortcuts(dialogOpen: boolean): {
  searchRef: RefObject<HTMLInputElement | null>
  runRef: RefObject<HTMLButtonElement | null>
} {
  const searchRef = useRef<HTMLInputElement>(null)
  const runRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (dialogOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const button = runRef.current
        if (button === null || button.disabled) return
        e.preventDefault()
        button.click()
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = document.activeElement
        const typing =
          el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (typing) return
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogOpen])
  return { searchRef, runRef }
}
