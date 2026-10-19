import type { JSX } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, X, Check } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { assistantApi, type AssistantMessage, type AssistantProposal } from '../../api/assistant.js'
import { useApp } from '../../store.js'
import type { Graph } from '../../lib/graph-types.js'
import { Button } from '../ui/button.js'
import { Select, type SelectOption } from '../ui/select.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { cn } from '../../lib/utils.js'

const ALL_AGENT_OPTIONS: SelectOption[] = [
  { value: 'claude', label: 'Claude', icon: <AgentIcon agent="claude" className="size-4" /> },
  { value: 'codex', label: 'Codex', icon: <AgentIcon agent="codex" className="size-4" /> },
]

/**
 * The AI workflow assistant side-panel. The user chats with an agent (Claude or
 * Codex) to create or edit the open workflow. Each send spawns the agent headless
 * on the engine; the reply (and any proposed graph) is appended here. A proposal
 * is applied to the canvas only when the user clicks "Apply to canvas".
 *
 * Persistence is per workflow: a saved workflow's thread is loaded on open. An
 * unsaved ('new') canvas has no id yet, so the panel asks the user to Save first
 * (the simpler robust option) before chatting.
 */
export function AssistantPanel({
  client,
  workflowId,
  buildGraph,
  onApply,
  onClose,
}: {
  client: AxiosInstance
  /** The saved workflow id, or undefined for an unsaved canvas. */
  workflowId: string | undefined
  /** Serialize the current canvas to the engine graph shape (sent with each message). */
  buildGraph: () => Graph
  /** Load a proposed graph onto the canvas. */
  onApply: (proposal: AssistantProposal) => void
  onClose: () => void
}): JSX.Element {
  const api = useMemo(() => assistantApi(client), [client])
  const installedAgents = useApp((s) => s.installedAgents)
  const agentOptions = useMemo(
    () => ALL_AGENT_OPTIONS.filter((o) => installedAgents === null || installedAgents.includes(o.value)),
    [installedAgents],
  )
  const [agent, setAgent] = useState('claude')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Load (or create) the conversation for the open workflow. Re-runs when the
  // workflow changes (e.g. after the first Save binds a real id).
  useEffect(() => {
    if (workflowId === undefined) {
      setConversationId(undefined)
      setMessages([])
      return
    }
    let cancelled = false
    void api
      .conversation(workflowId, agent)
      .then((data) => {
        if (cancelled) return
        setConversationId(data.conversation.id)
        setMessages(data.messages)
        setAgent(data.conversation.agent)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the conversation.')
      })
    return () => {
      cancelled = true
    }
    // agent intentionally excluded: switching agent is handled by switchAgent so
    // reloading here would clobber the freshly-set agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, api])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, pending])

  const switchAgent = useCallback(
    (next: string) => {
      setAgent(next)
      if (conversationId !== undefined) void api.setAgent(conversationId, next).catch(() => undefined)
    },
    [api, conversationId],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || pending || conversationId === undefined) return
    setError(null)
    setDraft('')
    const optimistic: AssistantMessage = {
      id: `local-${Date.now()}`,
      conversationId,
      role: 'user',
      content: text,
      proposal: null,
      createdAt: new Date().toISOString(),
    }
    setMessages((cur) => [...cur, optimistic])
    setPending(true)
    try {
      const message = await api.send(conversationId, { text, graph: buildGraph(), agent })
      setMessages((cur) => [...cur, message])
    } catch {
      setError('The agent run failed. Check that the agent CLI is installed and try again.')
    } finally {
      setPending(false)
    }
  }, [draft, pending, conversationId, api, buildGraph, agent])

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-4 text-[var(--ai,#8b5cf6)]" strokeWidth={1.75} />
        <span className="text-[13px] font-medium">AI Assistant</span>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={agent}
            onValueChange={switchAgent}
            options={agentOptions}
            ariaLabel="Assistant agent"
            className="h-8 w-[120px]"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Close assistant" onClick={onClose}>
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {workflowId === undefined ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Save this workflow first, then chat with the assistant to build or edit it.
          </p>
        </div>
      ) : (
        <>
          <div ref={listRef} className="scrollbar-sleek flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && !pending && (
              <p className="px-1 text-[13px] text-muted-foreground">
                Ask the assistant to create or edit this workflow. It proposes a graph you review before applying.
              </p>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onApply={onApply} />
            ))}
            {pending && (
              <div className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Thinking…
              </div>
            )}
            {error !== null && <p className="px-1 text-[13px] text-status-error">{error}</p>}
          </div>

          <div className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                placeholder="Describe the workflow to build or change…"
                disabled={pending}
                className={cn(
                  'scrollbar-sleek max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[13px] outline-none',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                )}
              />
              <Button size="icon-sm" aria-label="Send" disabled={pending || draft.trim() === ''} onClick={() => void send()}>
                <Send className="size-4" strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Compact markdown for assistant replies, styled with the app's tokens. */
const CODE_INLINE = 'rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px]'

/** Defined once: a fresh object per render would rebuild the renderer's component map on every keystroke. */
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 break-words last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5 break-words">{children}</li>,
  h1: ({ children }) => <h1 className="mb-1 mt-1 text-[14px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-1 text-[13.5px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 text-[13px] font-semibold">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>
  ),
  code: ({ className, children }) =>
    className?.startsWith('language-') ? (
      <code className="font-mono text-[12px]">{children}</code>
    ) : (
      <code className={CODE_INLINE}>{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="scrollbar-sleek mb-2 overflow-x-auto rounded bg-surface-2 p-2 text-[12px] last:mb-0">
      {children}
    </pre>
  ),
}

const REMARK_PLUGINS = [remarkGfm]

function AssistantMarkdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="text-[13px] leading-relaxed">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/**
 * One message. Memoized because the draft textarea's state lives in the panel:
 * every keystroke re-renders it, and re-rendering a bubble re-parses that whole
 * reply through remark — enough to make typing lag once a thread has a few
 * answers in it. `message` objects and `onApply` are stable, so this holds.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  onApply,
}: {
  message: AssistantMessage
  onApply: (proposal: AssistantProposal) => void
}): JSX.Element {
  const isUser = message.role === 'user'
  const [applied, setApplied] = useState(false)
  return (
    <div className={cn('flex min-w-0 flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          // [overflow-wrap:anywhere] + break-words keep long tokens/URLs inside
          // the bubble so nothing spills out and forces a horizontal scrollbar.
          'max-w-[92%] min-w-0 break-words [overflow-wrap:anywhere] rounded-lg px-3 py-2 text-[13px]',
          isUser
            ? 'whitespace-pre-wrap bg-surface-3 text-foreground'
            : 'bg-surface-1 text-foreground',
        )}
      >
        {message.content === '' ? (
          <span className="text-muted-foreground">(no reply)</span>
        ) : isUser ? (
          message.content
        ) : (
          <AssistantMarkdown text={message.content} />
        )}
      </div>
      {message.proposal !== null && (
        <div className="mt-2 w-[92%] rounded-lg border border-border bg-popover p-2.5">
          <p className="mb-2 text-[12px] text-muted-foreground">{message.proposal.summary}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              onApply(message.proposal as AssistantProposal)
              setApplied(true)
            }}
          >
            {applied ? <Check className="size-4" strokeWidth={1.75} /> : <Sparkles className="size-4" strokeWidth={1.75} />}
            {applied ? 'Applied' : 'Apply to canvas'}
          </Button>
        </div>
      )}
    </div>
  )
})
