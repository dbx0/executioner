import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../../store.js'
import { targetsApi, type TargetSummary } from '../../api/targets.js'
import { backendsApi, type BackendProfile } from '../../api/backends.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Button } from '../ui/button.js'
import { Select } from '../ui/select.js'

const MAX_ROWS = 100

/**
 * The least a run needs: a name for the header, the agent string to launch, and
 * the prompt to prime it with. A saved agent satisfies this, and so does a team
 * picked straight from the "+" menu (which carries no prompt of its own).
 */
export interface RunnableAgent {
  name: string
  agent: string
  prompt: string
}

/**
 * Compose the interactive prompt for an agent run: the agent's own prompt, the
 * chosen targets, and (when the backend is not local) an instruction to run
 * every shell command through the run_command tool on that backend. A team
 * launched from the menu has no prompt, so every block is optional.
 */
export function composeRunPrompt(
  agent: RunnableAgent,
  targets: { value: string; kind: string }[],
  backendId: string,
): string {
  const blocks: string[] = []
  const prompt = agent.prompt.trim()
  if (prompt !== '') blocks.push(prompt)
  if (targets.length > 0) {
    blocks.push(['Targets:', ...targets.map((t) => `- ${t.value} (${t.kind})`)].join('\n'))
  }
  if (backendId !== 'local') {
    blocks.push(
      `Run all shell commands through the run_command tool with backend "${backendId}" so they execute on the configured backend; do not run them locally.`,
    )
  }
  return blocks.join('\n\n')
}

/**
 * Run a saved agent: pick one or more targets, choose connectivity (Local or a
 * saved backend profile), then start a primed agent terminal. Enforced backend
 * routing (run_command) needs Claude; other base agents still launch primed.
 */
export function RunAgentModal({
  agent,
  onClose,
}: {
  agent: RunnableAgent
  onClose: () => void
}): JSX.Element {
  const client = useApp((s) => s.client)!
  const createSession = useApp((s) => s.createSession)
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [backends, setBackends] = useState<BackendProfile[]>([])
  const [selected, setSelected] = useState<TargetSummary[]>([])
  const [backendId, setBackendId] = useState('local')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void targetsApi(client)
      .list()
      .then((list) => alive && setTargets(list))
      .catch(() => {})
    void backendsApi(client)
      .list()
      .then((list) => alive && setBackends(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client])

  const selectedIds = useMemo(() => new Set(selected.map((t) => t.id)), [selected])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = (q === '' ? targets : targets.filter((t) => t.value.toLowerCase().includes(q))).filter(
      (t) => !selectedIds.has(t.id),
    )
    return matched.slice(0, MAX_ROWS)
  }, [targets, query, selectedIds])

  const addTarget = (t: TargetSummary): void => {
    setSelected((prev) => [...prev, t])
    setQuery('')
  }
  const removeTarget = (id: string): void => setSelected((prev) => prev.filter((t) => t.id !== id))

  // Claude and Claude teams both launch the claude CLI, so both support the
  // enforced backend routing (run_command) that other base agents lack.
  const isClaude = agent.agent === 'claude' || agent.agent.startsWith('claude-team')
  const backendOptions = [
    { value: 'local', label: 'Local' },
    ...backends.map((b) => ({ value: b.id, label: `${b.name} (${b.kind})` })),
  ]

  const run = (): void => {
    const composed = composeRunPrompt(
      agent,
      selected.map((t) => ({ value: t.value, kind: t.kind })),
      backendId,
    )
    // A team picked from the menu with no targets composes to nothing; launch it bare.
    void createSession(composed === '' ? { agent: agent.agent } : { agent: agent.agent, prompt: composed })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[520px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AgentIcon agent={agent.agent} className="size-4" />
          <span className="truncate text-[14px] font-medium">Run “{agent.name}”</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Targets</label>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-0.5 text-[12px]"
                >
                  <span className="font-mono">{t.value}</span>
                  <button type="button" aria-label={`Remove ${t.value}`} onClick={() => removeTarget(t.id)}>
                    <X className="size-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative mb-3">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              placeholder={targets.length === 0 ? 'No targets — add one first' : `Search ${targets.length} targets…`}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {open && results.length > 0 && (
              <div className="scrollbar-sleek absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-floating">
                {results.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addTarget(t)
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                  >
                    <span className="truncate font-mono text-[12px]">{t.value}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{t.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Connectivity</label>
          <Select value={backendId} onValueChange={setBackendId} options={backendOptions} />

          {backendId !== 'local' && !isClaude && (
            <p className="mt-2 text-[11px] text-attention">
              Enforced backend routing (run_command) needs Claude. This agent will launch primed with the task, but
              commands may run locally.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={run}>
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
