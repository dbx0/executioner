import { useEffect } from 'react'

/**
 * What floats over the app and so must hide the native browser views, which always draw above
 * the renderer: dialogs and menus by role, Radix popper content (dropdowns, selects, tooltips),
 * sonner toasts (except the attention toaster's), the cmdk palette, every `fixed inset-0` backdrop (modals, the tab and pane menu
 * scrims, the icon picker) and the app's own fixed menus (`z-[71]`).
 */
const OVERLAYS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
  '[data-sonner-toast]',
  '[cmdk-root]',
  '.fixed.inset-0',
  '.z-\\[71\\]',
].join(',')

/** Whether anything that must cover the browser views is open under `root`. */
export function hasOverlay(root: ParentNode): boolean {
  for (const el of root.querySelectorAll(OVERLAYS)) {
    // Anything inside a workspace pane (the pane picker, Monaco's suggest and find widgets that
    // stay mounted after use) cannot float over another pane; the real layers mount outside panes.
    if (el.closest('[data-pane-leaf]') !== null) continue
    // The attention toaster sits over the titlebar and tab strip, which no browser view reaches,
    // and its toasts ask the operator to work in a browser: hiding that browser would defeat them.
    if (el.closest('.attention-toaster') !== null) continue
    // Overlays kept in the DOM but hidden by attribute do not cover anything.
    if (el.closest('[hidden], [aria-hidden="true"]') !== null) continue
    return true
  }
  return false
}

/** Tell main to hide the browser views while an overlay is open and show them again after. */
export function useBrowserOcclusion(): void {
  useEffect(() => {
    // Unknown until the first check, which always reports so a reloaded renderer corrects main.
    let occluded: boolean | null = null
    const check = (): void => {
      const next = hasOverlay(document.body)
      if (next === occluded) return
      occluded = next
      // Shell tests stub a partial bridge; only the real preload has the browser half.
      ;(window.executioner as Partial<Window['executioner']>).browser?.setOccluded(next)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state', 'role'],
    })
    return () => observer.disconnect()
  }, [])
}
