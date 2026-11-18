import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import type { BrowserState } from '../../../main/browser/page.js'
import { useApp } from '../../store.js'
import type { BrowserTab } from '../../store/types.js'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Spinner } from '../../components/ui/spinner.js'
import { cn } from '../../lib/utils.js'
import { TabMenuItem } from './TabMenu.js'
import { BrowserAskModal } from './BrowserAskModal.js'

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
 * The amber trigger bar for what an agent asked the operator for. It only truncates the ask
 * and opens the modal, where the full message and the reply box live: an agent's message can
 * run long, and the inline box was too cramped to read or answer in. The agent's
 * browser_ask_operator call stays blocked until the modal's Submit answers it.
 */
function AskBanner({ id, who, message }: { id: string; who: string; message: string }): JSX.Element {
  const answerBrowserAsk = useApp((s) => s.answerBrowserAsk)
  // The open state lives in the store so the attention notch can open this dialog too.
  const open = useApp((s) => s.expandedBrowserAsk === id)
  const setExpanded = useApp((s) => s.setBrowserAskExpanded)
  return (
    <div
      role="status"
      data-browser-ask
      className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-attention/15 py-1 pl-3.5 pr-1.5 text-xs text-attention"
    >
      <button
        type="button"
        onClick={() => setExpanded(id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="font-medium">{who} needs you:</span>
        <span className="min-w-0 flex-1 truncate font-normal opacity-90">{message}</span>
      </button>
      <Button variant="glass" size="xs" className="shrink-0" onClick={() => setExpanded(id)}>
        Respond
      </Button>
      {open && (
        <BrowserAskModal
          who={who}
          message={message}
          onClose={() => setExpanded(null)}
          onSubmit={(reply) => {
            setExpanded(null)
            void answerBrowserAsk(id, reply)
          }}
        />
      )}
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
    <div data-browser-pane={id} data-active={active} className="flex h-full flex-col">
      <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-glass-border px-2">
        <Button variant="ghost" size="icon-xs" className="size-7" aria-label="Back" disabled={!state.canGoBack} onClick={() => operate('back')}>
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        </Button>
        <Button variant="ghost" size="icon-xs" className="size-7" aria-label="Forward" disabled={!state.canGoForward} onClick={() => operate('forward')}>
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
        <Input
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
          className="h-7 min-w-0 flex-1 px-3 text-xs"
        />
        {error !== null && (
          <span role="alert" className="max-w-[160px] truncate text-[11px] text-status-error" title={error}>
            {error}
          </span>
        )}
        {state.title !== '' && (
          <span className="hidden max-w-[160px] shrink truncate text-[11px] text-muted-foreground sm:block" title={state.title}>
            {state.title}
          </span>
        )}
        {acting && ownerLabel !== null && (
          <span
            className="min-w-0 max-w-[180px] shrink truncate rounded-control bg-glass-active px-2 py-0.5 text-[11px] text-foreground"
            title={`${ownerLabel} is using this page`}
          >
            {ownerLabel} is using this page
          </span>
        )}
        {state.loading && (
          <>
            <Spinner size="xs" className="text-muted-foreground" />
            <div className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-muted-foreground" data-testid="browser-loading" />
          </>
        )}
      </div>
      {ask !== undefined && <AskBanner key={ask} id={id} who={ownerLabel ?? 'An agent'} message={ask} />}
      <div ref={pageRef} data-browser-page className={cn('relative min-h-0 flex-1')}>
        {crashed && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>This page crashed.</p>
            <Button variant="glass" size="sm" onClick={() => operate('reload')}>
              Reload
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
