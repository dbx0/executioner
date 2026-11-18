import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, X } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import { assistantApi, type AssistantMessage, type AssistantProposal } from '../../api/assistant.js'
import { useApp } from '../../store.js'
import type { Graph } from '../../lib/graph-types.js'
import { Button } from '../ui/button.js'
import { Select, type SelectOption } from '../ui/select.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Spinner, LoadingState } from '../ui/spinner.js'
import { Textarea } from '../ui/textarea.js'
import { MessageBubble } from './AssistantMessageBubble.js'
import { FloatingPanel, PanelHeader } from './surface.js'

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
 * unsaved ('new') canvas has no id yet, so the first message saves it (through
 * `ensureSaved`) to get one, then opens the thread on that id.
 */
export function AssistantPanel({
  client,
  workflowId,
  buildGraph,
  ensureSaved,
  onApply,
  onClose,
}: {
  client: AxiosInstance
  /** The saved workflow id, or undefined for an unsaved canvas. */
  workflowId: string | undefined
  /** Serialize the current canvas to the engine graph shape (sent with each message). */
  buildGraph: () => Graph
  /** Save the canvas if it has no id yet and return the workflow id. */
  ensureSaved: () => Promise<string | undefined>
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
  // The stored thread for a saved workflow is in flight.
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  // True while `send` is saving an unsaved canvas and opening its thread itself.
  // The load effect below fires as soon as the new id arrives and would replace
  // the message just typed with the (empty) stored thread.
  const openingThread = useRef(false)

  // Load (or create) the conversation for the open workflow. Re-runs when the
  // workflow changes (e.g. after the first Save binds a real id).
  useEffect(() => {
    if (workflowId === undefined) {
      setConversationId(undefined)
      setMessages([])
      return
    }
    if (openingThread.current) return
    let cancelled = false
    setLoading(true)
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
      .finally(() => {
        if (!cancelled) setLoading(false)
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
    if (text === '' || pending) return
    setError(null)
    setDraft('')
    const optimistic: AssistantMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'user',
      content: text,
      proposal: null,
      createdAt: new Date().toISOString(),
    }
    setMessages((cur) => [...cur, optimistic])
    setPending(true)
    try {
      let convId = conversationId
      if (convId === undefined) {
        // Unsaved canvas: save it to get an id, then open its thread.
        openingThread.current = true
        try {
          const savedId = await ensureSaved()
          if (savedId === undefined) throw new Error('not saved')
          convId = (await api.conversation(savedId, agent)).conversation.id
          setConversationId(convId)
        } catch {
          setMessages((cur) => cur.filter((m) => m.id !== optimistic.id))
          setDraft(text)
          setError('Could not save the workflow to start the conversation. Try again.')
          return
        } finally {
          openingThread.current = false
        }
      }
      const message = await api.send(convId, { text, graph: buildGraph(), agent })
      setMessages((cur) => [...cur, message])
    } catch {
      setError('The agent run failed. Check that the agent CLI is installed and try again.')
    } finally {
      setPending(false)
    }
  }, [draft, pending, conversationId, api, buildGraph, ensureSaved, agent])

  return (
    <FloatingPanel asChild className="flex h-full w-[340px] shrink-0 flex-col">
      <aside aria-label="AI assistant">
        <PanelHeader title="AI Assistant" icon={<Sparkles className="size-4 text-ai" strokeWidth={1.75} />}>
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
        </PanelHeader>

        <div ref={listRef} className="scrollbar-sleek flex-1 space-y-3 overflow-y-auto border-t border-glass-border p-3">
          {loading && messages.length === 0 && <LoadingState label="Loading the conversation" />}
          {messages.length === 0 && !pending && !loading && (
            <p className="px-1 text-[13px] text-muted-foreground">
              Ask the assistant to create or edit this workflow. It proposes a graph you review before applying.
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onApply={onApply} />
          ))}
          {pending && (
            <div role="status" className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
              <Spinner size="sm" className="text-ai" />
              Thinking…
            </div>
          )}
          {error !== null && <p className="px-1 text-[13px] text-status-error">{error}</p>}
        </div>

        <div className="flex items-end gap-2 p-2">
          <Textarea
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
            aria-label="Message the assistant"
            disabled={pending}
            className="max-h-32 min-h-[2.25rem] flex-1 text-[13px]"
          />
          <Button size="icon-sm" aria-label="Send" disabled={pending || draft.trim() === ''} onClick={() => void send()}>
            {pending ? <Spinner size="sm" /> : <Send className="size-4" strokeWidth={1.75} />}
          </Button>
        </div>
      </aside>
    </FloatingPanel>
  )
}
