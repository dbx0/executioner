import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import type { BrowserState } from '../../../main/browser/page.js'
import { useApp } from '../../store.js'
import type { BrowserTab } from '../../store/types.js'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { TabMenuItem } from './TabMenu.js'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** What the address bar sends: a URL with a scheme as typed, anything else over https. */
function normalizeAddress(input: string): string | null {
  const text = input.trim()
  if (text === '') return null
  if (text === 'about:blank' || SCHEME.test(text)) return text
  return `https://${text}`
}

/** The "Hand to agent…" and "Take back" entries of a browser's tab or pane menu. */
export function BrowserHandoffItems({ id, close }: { id: string; close: () => void }): JSX.Element {
  const owner = useApp((s) => s.browsers.find((b) => b.id === id)?.owner ?? null)
  const sessions = useApp((s) => s.sessions)
  const setBrowserOwner = useApp((s) => s.setBrowserOwner)
  const [listing, setListing] = useState(false)
  const agents = sessions.filter((s) => s.agent !== 'shell')
  return (
    <>
      <TabMenuItem onClick={() => setListing((v) => !v)}>Hand to agent…</TabMenuItem>
      {listing && (
        <div className="pl-3">
          {agents.length === 0 && <TabMenuItem disabled onClick={() => undefined}>No agent sessions</TabMenuItem>}
          {agents.map((s) => (
            <TabMenuItem
              key={s.id}
              onClick={() => {
                close()
                void setBrowserOwner(id, s.id)
              }}
            >
              {s.title ?? s.label}
            </TabMenuItem>
          ))}
        </div>
      )}
      {owner !== null && (
        <TabMenuItem
          onClick={() => {
            close()
            void setBrowserOwner(id, null)
          }}
        >
          Take back
        </TabMenuItem>
      )}
    </>
  )
}

/**
 * What the agent asked the operator for. Only Done answers it: the agent's
 * browser_ask_operator call stays blocked until then, and gets the reply.
 */
function AskBanner({ id, message }: { id: string; message: string }): JSX.Element {
  const answerBrowserAsk = useApp((s) => s.answerBrowserAsk)
  const [reply, setReply] = useState('')
  const done = (): void => {
    const text = reply.trim()
    void answerBrowserAsk(id, text === '' ? undefined : text)
  }
  return (
    <div
      role="status"
      data-browser-ask
      className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-300"
    >
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      <input
        aria-label="Reply to the agent"
        placeholder="Reply (optional), for example a code"
        spellCheck={false}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            done()
          }
        }}
        className="h-6 w-56 min-w-0 shrink rounded-md border border-border bg-surface-2 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
      />
      <Button variant="outline" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={done}>
        Done
      </Button>
    </div>
  )
}

/**
 * One embedded browser: a renderer-side bar (back, forward, reload, address) over a page
 * area. The page itself is a native view owned by main; this pane only reports where its
 * area sits (null when the pane is not on screen) and shows the page's state.
 */
export function BrowserPane({
  root,
  browser,
  active,
  visible,
}: {
  root: string
  browser: BrowserTab
  active: boolean
  visible: boolean
}): JSX.Element {
  const id = browser.id
  const [state, setState] = useState<BrowserState>({
    url: browser.url,
    title: browser.title,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    crashed: false,
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const ask = useApp((s) => s.browserAsks[id])
  const acting = useApp((s) => s.browserActivity[id] === true)
  const ownerLabel = useApp((s) => {
    const owner = s.sessions.find((x) => x.id === browser.owner)
    return owner === undefined ? null : (owner.title ?? owner.label)
  })

  // Main's pushes carry the engine's project root, which may differ textually from this
  // engagement's root; browser ids are globally unique, so match on the id alone.
  useEffect(
    () =>
      window.executioner.browser.onState((e) => {
        if (e.id === id) setState(e.state)
      }),
    [id],
  )

  // Park the native view whenever this pane stops being on screen or goes away.
  useEffect(() => () => window.executioner.browser.place({ root, id, bounds: null }), [root, id])

  const crashed = state.crashed
  // The ask banner takes its height from the page area, so the native view starts below it and
  // nothing on the page is covered. The area's ResizeObserver reports that; placing again when
  // the banner comes or goes means the bounds never depend on that callback alone.
  const asking = ask !== undefined
  useEffect(() => {
    const el = pageRef.current
    const api = window.executioner.browser
    if (el === null || !visible || crashed) {
      api.place({ root, id, bounds: null })
      return
    }
    let last = ''
    const send = (): void => {
      const r = el.getBoundingClientRect()
      const bounds =
        r.width > 0 && r.height > 0
          ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
          : null
      const key = JSON.stringify(bounds)
      if (key === last) return
      last = key
      api.place({ root, id, bounds })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [root, id, visible, crashed, asking])

  const operate = (op: 'back' | 'forward' | 'reload' | 'stop' | { navigate: string }): void => {
    setError(null)
    window.executioner.browser.operator({ root, id, op }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not do that')
    })
  }

  const submit = (): void => {
    const url = normalizeAddress(draft ?? state.url)
    setDraft(null)
    if (url !== null) operate({ navigate: url })
  }

  return (
    <div data-browser-pane={id} data-active={active} className="flex h-full flex-col bg-card">
      <div className="relative flex h-8 shrink-0 items-center gap-1 border-b border-border px-1.5">
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Back" disabled={!state.canGoBack} onClick={() => operate('back')}>
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Forward" disabled={!state.canGoForward} onClick={() => operate('forward')}>
          <ArrowRight className="size-3.5" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label={state.loading ? 'Stop loading' : 'Reload page'}
          onClick={() => operate(state.loading ? 'stop' : 'reload')}
        >
          {state.loading ? <X className="size-3.5" strokeWidth={1.75} /> : <RotateCw className="size-3.5" strokeWidth={1.75} />}
        </Button>
        <input
          aria-label="Address"
          spellCheck={false}
          value={draft ?? state.url}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              setDraft(null)
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-xs text-foreground outline-none focus:border-border-strong"
        />
        {error !== null && (
          <span role="alert" className="max-w-[160px] truncate text-[11px] text-destructive" title={error}>
            {error}
          </span>
        )}
        {state.title !== '' && (
          <span className="hidden max-w-[160px] shrink truncate text-[11px] text-muted-foreground sm:block" title={state.title}>
            {state.title}
          </span>
        )}
        {acting && ownerLabel !== null && (
          <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-foreground">
            {ownerLabel} is using this page
          </span>
        )}
        {state.loading && <div className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-muted-foreground" data-testid="browser-loading" />}
      </div>
      {ask !== undefined && <AskBanner key={ask} id={id} message={ask} />}
      <div ref={pageRef} data-browser-page className={cn('relative min-h-0 flex-1')}>
        {crashed && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>This page crashed.</p>
            <Button variant="outline" size="sm" onClick={() => operate('reload')}>
              Reload
            </Button>
          </div>
        )}
        {!crashed && window.executioner.platform === 'linux' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
            Opened in host browser window
          </div>
        )}
      </div>
    </div>
  )
}
