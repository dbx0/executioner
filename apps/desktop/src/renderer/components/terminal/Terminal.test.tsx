import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { Terminal } from './Terminal.js'

/** Captures what the component wires up: the key handler and what it sends. */
const sent: string[] = []
const pasted: string[] = []
let keyHandler: ((e: KeyboardEvent) => boolean) | undefined
let selection = ''
let lastTerm: { options: { theme?: { background: string } } } | undefined

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 30
    options: { theme?: { background: string } } = { theme: { background: 'initial' } }
    open(): void {}
    loadAddon(): void {}
    onData(): void {}
    dispose(): void {}
    write(): void {}
    constructor() {
      lastTerm = this as unknown as { options: { theme?: { background: string } } }
    }
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean): void {
      keyHandler = fn
    }
    paste(text: string): void {
      pasted.push(text)
    }
    getSelection(): string {
      return selection
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
// The component loads the WebGL renderer lazily; jsdom has no WebGL context.
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    dispose(): void {}
  },
}))

class FakeSocket {
  static OPEN = 1
  OPEN = 1
  readyState = 1
  onmessage: unknown
  onclose: unknown
  onopen: unknown
  send(d: string): void {
    sent.push(d)
  }
  close(): void {}
}
vi.stubGlobal('WebSocket', FakeSocket)
// jsdom has no ResizeObserver; the component observes its container for fitting.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    disconnect(): void {}
  },
)

const clipboard = { text: '', written: [] as string[], throws: false }
vi.stubGlobal('window', Object.assign(window, {
  executioner: {
    clipboardRead: () => {
      if (clipboard.throws) throw new Error('no bridge')
      return Promise.resolve(clipboard.text)
    },
    clipboardWrite: (t: string) => {
      clipboard.written.push(t)
      return Promise.resolve()
    },
  },
}))

const connection = { port: 1, token: 't', projectRoot: '/tmp/acme' }
const shiftEnter = () => new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })

describe('Terminal — Shift+Enter', () => {
  beforeEach(() => {
    sent.length = 0
    pasted.length = 0
    clipboard.text = ''
    clipboard.written.length = 0
    selection = ''
    keyHandler = undefined
  })

  it('sends ESC+CR for an agent so the TUI inserts a newline instead of submitting', () => {
    // A terminal reports Shift+Enter as a plain CR, so without this the agent
    // cannot tell it from Enter. ESC+CR is what Claude Code's own terminal
    // setup installs for the same purpose.
    render(<Terminal connection={connection} sessionId="s1" multilineShiftEnter />)
    expect(keyHandler).toBeDefined()

    const event = shiftEnter()
    const handled = keyHandler!(event)

    expect(sent).toEqual(['\x1b\r'])
    // False suppresses xterm's default CR, which would submit the prompt.
    expect(handled).toBe(false)
    // And preventDefault stops the browser inserting a newline into xterm's
    // hidden textarea, which xterm would flush as a second keystroke — that is
    // what made Shift+Enter both submit and leave a stray blank line.
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves Shift+Enter alone in a plain shell', () => {
    // readline reads a leading ESC as a meta prefix, and Shift+Enter has always
    // been an ordinary Enter at a shell prompt.
    render(<Terminal connection={connection} sessionId="s2" />)

    expect(keyHandler!(shiftEnter())).toBe(true)
    expect(sent).toEqual([])
  })

  it('passes other Enter combinations through to the TUI', () => {
    render(<Terminal connection={connection} sessionId="s3" multilineShiftEnter />)

    expect(keyHandler!(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true)
    expect(keyHandler!(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, ctrlKey: true }))).toBe(true)
    expect(keyHandler!(new KeyboardEvent('keydown', { key: 'a', shiftKey: true }))).toBe(true)
    // keyup must not double-send.
    expect(keyHandler!(new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true }))).toBe(true)
    expect(sent).toEqual([])
  })
})

describe('Terminal — clipboard', () => {
  beforeEach(() => {
    sent.length = 0
    pasted.length = 0
    clipboard.text = ''
    clipboard.written.length = 0
    clipboard.throws = false
    selection = ''
    keyHandler = undefined
  })

  const press = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
    keyHandler!(new KeyboardEvent('keydown', { key, cancelable: true, ...mods }))

  /** Let the main-process clipboard read (a resolved promise here) land. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('pastes on Ctrl+V, which xterm would otherwise swallow as ^V', async () => {
    clipboard.text = 'https://target.example.com'
    render(<Terminal connection={connection} sessionId="s1" />)

    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    const handled = keyHandler!(event)
    await settle()

    expect(pasted).toEqual(['https://target.example.com'])
    // Suppressed, or the terminal also receives the ^V control code.
    expect(handled).toBe(false)
    // preventDefault also stops the browser's own paste, which would otherwise
    // insert the clipboard a second time through the hidden textarea.
    expect(event.defaultPrevented).toBe(true)
  })

  it('pastes on Ctrl+Shift+V and Cmd+V too', async () => {
    clipboard.text = 'payload'
    render(<Terminal connection={connection} sessionId="s2" />)

    press('v', { ctrlKey: true, shiftKey: true })
    press('V', { metaKey: true })
    await settle()

    expect(pasted).toEqual(['payload', 'payload'])
  })

  it('refuses a non-text clipboard instead of writing bytes into the PTY', async () => {
    // An image-only clipboard reads as empty text. Writing its bytes would
    // flood the agent's prompt with binary, so the key is consumed and nothing
    // is sent.
    clipboard.text = ''
    render(<Terminal connection={connection} sessionId="s3" />)

    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    expect(keyHandler!(event)).toBe(false)
    await settle()

    expect(pasted).toEqual([])
    expect(sent).toEqual([])
    expect(event.defaultPrevented).toBe(true)
  })

  it('hands the key back when the clipboard bridge is unavailable', () => {
    // Consuming the key with no way to read the clipboard would mean no paste
    // at all. Falling through lets the browser's native paste still work.
    clipboard.throws = true
    render(<Terminal connection={connection} sessionId="s7" />)

    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    expect(keyHandler!(event)).toBe(true)

    expect(pasted).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('copies the selection on Ctrl+Shift+C', () => {
    selection = 'captured output'
    render(<Terminal connection={connection} sessionId="s4" />)

    expect(press('c', { ctrlKey: true, shiftKey: true })).toBe(false)
    expect(clipboard.written).toEqual(['captured output'])
  })

  it('leaves plain Ctrl+C as SIGINT', () => {
    // Interrupting a runaway command must keep working.
    selection = 'something selected'
    render(<Terminal connection={connection} sessionId="s5" />)

    expect(press('c', { ctrlKey: true })).toBe(true)
    expect(clipboard.written).toEqual([])
  })

  it('passes Ctrl+Shift+C through when nothing is selected', () => {
    render(<Terminal connection={connection} sessionId="s6" />)

    expect(press('c', { ctrlKey: true, shiftKey: true })).toBe(true)
    expect(clipboard.written).toEqual([])
  })
})

describe('Terminal — theme changes', () => {
  it('repaints a terminal that is already open', async () => {
    // xterm keeps the concrete colours it read at construction, so without this
    // an open terminal stays on its old palette and only newly spawned ones
    // pick up the theme.
    const { useApp } = await import('../../store/create.js')
    render(<Terminal connection={connection} sessionId="s1" />)
    const term = lastTerm!
    const before = term.options.theme

    await act(async () => {
      useApp.getState().setTheme('midnight')
    })

    // A fresh palette object, read after the new CSS variables went live.
    expect(term.options.theme).toBeDefined()
    expect(term.options.theme).not.toBe(before)
  })

  it('does not repaint when the theme is unchanged', async () => {
    // The control: proves the repaint above came from the theme change and not
    // from every render.
    const { useApp } = await import('../../store/create.js')
    render(<Terminal connection={connection} sessionId="s2" />)
    const term = lastTerm!
    const before = term.options.theme

    await act(async () => {
      useApp.getState().toggleSidebar()
    })

    expect(term.options.theme).toBe(before)
  })
})

describe('Terminal — pastes from other routes', () => {
  /** A paste event carrying the given text/plain payload. */
  const pasteEvent = (text: string): ClipboardEvent => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
    return event
  }

  it('drops an image-only paste arriving from a context menu or middle-click', () => {
    // These routes bypass the key handler entirely; without this the bytes
    // would reach the PTY and land in the agent's prompt.
    const { container } = render(<Terminal connection={connection} sessionId="s1" />)
    const el = container.firstChild as HTMLElement

    const event = pasteEvent('')
    el.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('lets a normal text paste through by that route', () => {
    const { container } = render(<Terminal connection={connection} sessionId="s2" />)
    const el = container.firstChild as HTMLElement

    const event = pasteEvent('https://target.example.com')
    el.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
