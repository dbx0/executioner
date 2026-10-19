/**
 * Containers that draw a context menu of their own, or whose own menu is the
 * useful one. Suppressing inside these would take away a working menu rather
 * than replace a stray one.
 */
const OWNS_ITS_MENU = ['.monaco-editor', '.xterm']

/**
 * Whether the OS menu should still be allowed for this element.
 *
 * The native menu earns its place in exactly one situation: somewhere text can
 * be selected and edited, where cut/copy/paste and the spell checker are the
 * whole point. Everywhere else in a desktop app it is a browser artefact —
 * Back, Reload, Inspect — offering nothing about the thing that was clicked.
 */
export function keepsNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  if (target.closest(OWNS_ITS_MENU.join(',')) !== null) return true
  if (target.closest('[contenteditable=""], [contenteditable="true"]') !== null) return true

  const field = target.closest('input, textarea')
  if (field === null) return false

  // A field that cannot be typed into has nothing for the menu to act on.
  const disabled = (field as HTMLInputElement).disabled
  const readOnly = (field as HTMLInputElement).readOnly
  return !disabled && !readOnly
}

/**
 * Swallows the operating system's context menu across the app, leaving text
 * fields and the editors that draw their own alone.
 *
 * Listens in the bubble phase and on `document`, so any component that wants a
 * custom menu has already seen the event and called `preventDefault` by the
 * time this runs. Returns the uninstall function.
 */
export function installNativeContextMenuSuppression(): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    if (keepsNativeMenu(event.target)) return
    event.preventDefault()
  }

  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}
