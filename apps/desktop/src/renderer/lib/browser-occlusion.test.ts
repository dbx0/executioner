import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasOverlay, useBrowserOcclusion } from './browser-occlusion.js'

const setOccluded = vi.fn()

beforeEach(() => {
  setOccluded.mockClear()
  window.executioner = { browser: { setOccluded } } as unknown as typeof window.executioner
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('browser occlusion', () => {
  it('hides browser views while an overlay is open', async () => {
    renderHook(() => useBrowserOcclusion())
    expect(setOccluded).toHaveBeenCalledTimes(1)
    expect(setOccluded).toHaveBeenLastCalledWith(false)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    await waitFor(() => expect(setOccluded).toHaveBeenLastCalledWith(true))
    dialog.remove()
    await waitFor(() => expect(setOccluded).toHaveBeenLastCalledWith(false))
    expect(setOccluded).toHaveBeenCalledTimes(3)
  })

  it('ignores a cmdk picker inside a pane', () => {
    document.body.innerHTML = '<div data-pane-leaf="p"><div cmdk-root=""><div role="listbox"></div></div></div>'
    expect(hasOverlay(document.body)).toBe(false)
    document.body.innerHTML = '<div cmdk-root=""></div>'
    expect(hasOverlay(document.body)).toBe(true)
  })

  it("ignores the attention toaster's toasts, which never reach a browser view, but not other toasts", () => {
    document.body.innerHTML = '<ol data-sonner-toaster class="attention-toaster"><li data-sonner-toast></li></ol>'
    expect(hasOverlay(document.body)).toBe(false)
    document.body.innerHTML = '<ol data-sonner-toaster><li data-sonner-toast></li></ol>'
    expect(hasOverlay(document.body)).toBe(true)
  })

  it('ignores dialogs and listboxes inside a pane', () => {
    document.body.innerHTML = '<div data-pane-leaf="p"><div role="dialog"></div><div role="listbox"></div></div>'
    expect(hasOverlay(document.body)).toBe(false)
    document.body.innerHTML = '<div role="dialog"></div>'
    expect(hasOverlay(document.body)).toBe(true)
    document.body.innerHTML = '<div role="listbox"></div>'
    expect(hasOverlay(document.body)).toBe(true)
  })

  it('ignores overlays hidden by attribute', () => {
    document.body.innerHTML = '<div role="dialog" hidden></div>'
    expect(hasOverlay(document.body)).toBe(false)
    document.body.innerHTML = '<div aria-hidden="true"><div role="menu"></div></div>'
    expect(hasOverlay(document.body)).toBe(false)
  })

  it('re-checks when an attribute toggles visibility', async () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.hidden = true
    document.body.appendChild(dialog)
    renderHook(() => useBrowserOcclusion())
    expect(setOccluded).toHaveBeenLastCalledWith(false)
    dialog.hidden = false
    await waitFor(() => expect(setOccluded).toHaveBeenLastCalledWith(true))
  })

  it('sends the current state once on mount', () => {
    renderHook(() => useBrowserOcclusion())
    expect(setOccluded).toHaveBeenCalledTimes(1)
    expect(setOccluded).toHaveBeenCalledWith(false)
  })

  it('catches menus, modal scrims, popper content and toasts', () => {
    for (const html of [
      '<div role="menu"></div>',
      '<div class="fixed inset-0 z-50"></div>',
      '<div class="fixed z-[71]"></div>',
      '<div data-radix-popper-content-wrapper=""></div>',
      '<li data-sonner-toast=""></li>',
    ]) {
      document.body.innerHTML = html
      expect(hasOverlay(document.body), html).toBe(true)
    }
    document.body.innerHTML = '<div class="plain"></div>'
    expect(hasOverlay(document.body)).toBe(false)
  })
})
