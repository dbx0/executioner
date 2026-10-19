import type { JSX } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useApp } from '../../store.js'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ptyUrl } from '../../lib/pty.js'
import { readTargetDrag, TARGET_DND_MIME } from '../../lib/target-drag.js'
import type { EngineConnection } from '../../lib/connection.js'

function terminalTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const s = getComputedStyle(document.documentElement)
  const bg = s.getPropertyValue('--card').trim() || '#0a0a0a'
  const fg = s.getPropertyValue('--foreground').trim() || '#fafafa'
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    selectionBackground: 'rgba(120,120,120,0.35)',
  }
}

export function Terminal({
  connection,
  sessionId,
  onActivity,
  onExit,
  multilineShiftEnter = false,
}: {
  connection: EngineConnection
  sessionId: string
  onActivity?: (() => void) | undefined
  onExit?: (() => void) | undefined
  /**
   * Send ESC+CR for Shift+Enter so an agent TUI inserts a newline instead of
   * submitting. Off for plain shells, where Shift+Enter has always been an
   * ordinary Enter and readline would read the ESC as a meta prefix.
   */
  multilineShiftEnter?: boolean
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const termRef = useRef<Xterm | null>(null)
  // xterm keeps the concrete colours it read when it was constructed, so a theme
  // swap leaves an open terminal on its old palette while newly spawned ones look
  // right. The store is the signal: setTheme applies the CSS variables before it
  // updates state, so the new values are already live when this changes.
  const theme = useApp((s) => s.theme)
  const activityRef = useRef(onActivity)
  activityRef.current = onActivity
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  // Accept a target/fact/finding dragged from the Targets panel: write its
  // paste-ready reference into the PTY stdin (as if typed at the prompt), with a
  // trailing space so successive drops stay separated. Only our own drags are
  // handled — OS file drops fall through untouched.
  const onDragOver = useCallback((e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes(TARGET_DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  const onDrop = useCallback((e: React.DragEvent): void => {
    const text = readTargetDrag(e.dataTransfer)
    if (text === null) return
    e.preventDefault()
    const socket = socketRef.current
    if (socket !== null && socket.readyState === socket.OPEN) socket.send(`${text} `)
  }, [])

  useEffect(() => {
    const el = container.current
    if (el === null) return
    let intentional = false

    // Append symbol/Nerd-font fallbacks so box-drawing and powerline prompt
    // glyphs (╭ ╰ ❯ and Nerd-Font PUA icons in prompts like starship/p10k)
    // render instead of showing as tofu boxes.
    const cssMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    const glyphFallback =
      "'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', Menlo, Monaco, 'Apple Symbols', monospace"
    const term = new Xterm({
      convertEol: true,
      fontSize: 13,
      fontFamily: cssMono !== '' ? `${cssMono}, ${glyphFallback}` : glyphFallback,
      cursorBlink: true,
      theme: terminalTheme(),
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    void import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      })
      .catch(() => {
        /* DOM renderer fallback */
      })

    const socket = new WebSocket(ptyUrl(connection, sessionId))
    socketRef.current = socket
    socket.onmessage = (m) => {
      term.write(typeof m.data === 'string' ? m.data : '')
      activityRef.current?.()
    }
    // The engine closes the socket when the PTY process exits (e.g. the agent
    // quits on Ctrl+D). Distinguish that from our own unmount teardown.
    socket.onclose = () => {
      if (!intentional) exitRef.current?.()
    }
    term.onData((data) => {
      if (socket.readyState === socket.OPEN) socket.send(data)
    })

    const send = (data: string): void => {
      if (socket.readyState === socket.OPEN) socket.send(data)
    }

    /**
     * Take a key over from both xterm and the browser.
     *
     * Returning false only tells xterm to keep its hands off; the browser's own
     * default still runs, and focus sits in xterm's hidden textarea. So a bare
     * `return false` on Enter lets the browser insert a newline into that
     * textarea, which xterm then flushes as input — the keystroke is handled
     * twice. preventDefault is what actually stops that second path.
     */
    const consume = (e: KeyboardEvent): boolean => {
      e.preventDefault()
      e.stopPropagation()
      return false
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey

      // Paste. xterm maps Ctrl+V to the ^V control code and preventDefaults it,
      // so the browser's paste event never fires; without this there is no way
      // to paste into a terminal at all. Ctrl+Shift+V is the terminal
      // convention and Ctrl/Cmd+V is what a desktop app is expected to honour,
      // so both paste. (In vim, Ctrl+Q is the documented stand-in for the
      // visual-block Ctrl+V this takes over.)
      if (mod && e.key.toLowerCase() === 'v') {
        let read: Promise<string>
        try {
          // The clipboard lives in the main process (Electron no longer exposes
          // it to renderers), so the read is asynchronous: the key is consumed
          // now and the text pasted once it arrives.
          read = window.executioner.clipboardRead()
        } catch {
          // No bridge (an older preload, or tests). Hand the key back so the
          // browser's own paste still runs — consuming it here would mean no
          // paste happens at all, which is worse than the double-handling
          // preventDefault exists to stop.
          return true
        }
        void read
          .then((text) => {
            // Nothing textual to paste. Most often the clipboard holds an
            // image; writing its bytes into a PTY floods the agent's prompt
            // with binary, so it is refused and nothing is sent.
            if (text === '') return
            // term.paste wraps the text in bracketed-paste markers when the
            // app has them enabled, so a multi-line paste arrives as one paste
            // rather than as a burst of Enter presses.
            term.paste(text)
          })
          .catch(() => {
            /* clipboard unavailable */
          })
        // Consuming also stops the browser running its own paste into the
        // hidden textarea, which would insert the clipboard a second time.
        return consume(e)
      }

      // Copy the selection on Ctrl+Shift+C only. Plain Ctrl+C must stay SIGINT,
      // which is how a runaway command gets interrupted.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        const selection = term.getSelection()
        if (selection !== '') {
          try {
            void window.executioner.clipboardWrite(selection).catch(() => {
              /* clipboard unavailable */
            })
          } catch {
            /* clipboard unavailable */
          }
          return consume(e)
        }
        return true
      }

      // A terminal cannot distinguish Shift+Enter from Enter on its own: both
      // arrive as CR, which is why the agent submits instead of adding a line.
      // ESC+CR is the sequence Claude Code's own `/terminal-setup` installs for
      // this, so send that and suppress xterm's default CR.
      if (multilineShiftEnter && e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        send('\x1b\r')
        return consume(e)
      }

      return true
    })

    const safeFit = (): void => {
      // Only fit when the element actually has a size (it is hidden while its
      // tab is inactive), otherwise xterm throws on a zero-size proposal.
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }))
        }
      } catch {
        /* transient sizing race */
      }
    }
    socket.onopen = safeFit

    // Ctrl+V is not the only way a paste reaches the terminal — a context menu
    // or a middle-click sends one too, and those bypass the key handler above.
    // xterm reads text/plain from the event, so an image-only clipboard has no
    // business getting that far; drop it before any bytes reach the PTY.
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData
      if (data === null) return
      if (data.getData('text/plain') === '') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    el.addEventListener('paste', onPaste, true)

    const ro = new ResizeObserver(() => safeFit())
    ro.observe(el)

    return () => {
      intentional = true
      el.removeEventListener('paste', onPaste, true)
      ro.disconnect()
      socket.close()
      socketRef.current = null
      termRef.current = null
      term.dispose()
    }
  }, [connection, sessionId, multilineShiftEnter])

  // Repaint an already-open terminal when the theme changes. Nothing happens on
  // mount — the constructor above already read the current palette.
  useEffect(() => {
    const term = termRef.current
    if (term === null) return
    term.options.theme = terminalTheme()
  }, [theme])

  return <div ref={container} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop} />
}
