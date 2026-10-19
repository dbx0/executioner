import { afterEach, describe, expect, it } from 'vitest'
import { installNativeContextMenuSuppression, keepsNativeMenu } from './native-context-menu.js'

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
  document.body.innerHTML = ''
})

/** Right-clicks an element the way the browser would, and reports what happened. */
function rightClick(el: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

describe('keepsNativeMenu', () => {
  it('keeps it for a text input, where cut/copy/paste is the whole point', () => {
    const input = document.createElement('input')
    expect(keepsNativeMenu(input)).toBe(true)
  })

  it('keeps it for a textarea', () => {
    expect(keepsNativeMenu(document.createElement('textarea'))).toBe(true)
  })

  it('keeps it for a contenteditable region', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(keepsNativeMenu(div)).toBe(true)
  })

  it('keeps it inside the code editor, which draws its own menu', () => {
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const inner = document.createElement('span')
    editor.appendChild(inner)
    expect(keepsNativeMenu(inner)).toBe(true)
  })

  it('keeps it in the terminal, where the shell selection menu is wanted', () => {
    const term = document.createElement('div')
    term.className = 'xterm'
    const inner = document.createElement('span')
    term.appendChild(inner)
    expect(keepsNativeMenu(inner)).toBe(true)
  })

  it('drops it for ordinary chrome', () => {
    expect(keepsNativeMenu(document.createElement('div'))).toBe(false)
  })

  it('drops it for a disabled input, which has nothing to offer', () => {
    const input = document.createElement('input')
    input.disabled = true
    expect(keepsNativeMenu(input)).toBe(false)
  })

  it('drops it for a readonly input', () => {
    const input = document.createElement('input')
    input.readOnly = true
    expect(keepsNativeMenu(input)).toBe(false)
  })
})

describe('installNativeContextMenuSuppression', () => {
  it('swallows a right-click on ordinary chrome', () => {
    uninstall = installNativeContextMenuSuppression()
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(rightClick(div)).toBe(true)
  })

  it('lets a right-click on a text field through', () => {
    uninstall = installNativeContextMenuSuppression()
    const input = document.createElement('input')
    document.body.appendChild(input)
    expect(rightClick(input)).toBe(false)
  })

  it('stops swallowing once uninstalled', () => {
    const off = installNativeContextMenuSuppression()
    off()
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(rightClick(div)).toBe(false)
  })

  it('leaves a menu a component opened alone', () => {
    // A row handler that already called preventDefault has made its own
    // decision; the global guard must not fight it or re-handle the event.
    uninstall = installNativeContextMenuSuppression()
    const row = document.createElement('div')
    document.body.appendChild(row)
    let handled = false
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      handled = true
    })
    expect(rightClick(row)).toBe(true)
    expect(handled).toBe(true)
  })
})
