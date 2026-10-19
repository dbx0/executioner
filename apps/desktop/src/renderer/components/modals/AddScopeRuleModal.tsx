import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useApp } from '../../store.js'
import { targetsApi } from '../../api/targets.js'
import { scopeApi } from '../../api/scope.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { TEXTAREA_CLASS } from './new-engagement/constants.js'
import { FieldLabel } from './new-engagement/fields.js'
import { RunningPage } from './new-engagement/result-pages.js'

type Tab = 'manual' | 'ai'
type Phase = 'form' | 'running' | 'done'

const TABS: { id: Tab; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'ai', label: 'Start with AI' },
]

export interface AddScopeRuleModalProps {
  onClose: () => void
  /**
   * The boundary changed: reload the list. `rejudged` is how many target verdicts
   * the write moved, or null when the caller cannot know (the AI pass writes its
   * rules through MCP, so no single count comes back).
   */
  onApplied: (rejudged: number | null) => void
}

/**
 * Add to the engagement's boundary, either one rule at a time or by pasting the
 * program's scope and letting the default agent write the rules.
 *
 * The AI tab runs the same `/scope/parse` pass as "Start with AI" on a new
 * engagement — the agent records the boundary first, then the assets — so a
 * mid-engagement scope update goes through the path that already knows how to
 * turn program prose into include/exclude rules.
 */
export function AddScopeRuleModal({ onClose, onApplied }: AddScopeRuleModalProps): JSX.Element {
  const client = useApp((s) => s.client)
  const defaultAgent = useApp((s) => s.defaultAgent)
  const beginScopeRun = useApp((s) => s.beginScopeRun)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])

  const [tab, setTab] = useState<Tab>('manual')
  const [phase, setPhase] = useState<Phase>('form')
  const [effect, setEffect] = useState<'include' | 'exclude'>('include')
  const [pattern, setPattern] = useState('')
  const [note, setNote] = useState('')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [rulesAdded, setRulesAdded] = useState(0)
  const patternRef = useRef<HTMLInputElement>(null)

  const scopeRun = useApp((s) => (runId !== null ? s.scopeRuns[runId] : undefined))

  useEffect(() => {
    patternRef.current?.focus()
  }, [])

  // The agent writes its rules through MCP, so the count comes from the list
  // itself: snapshot before the run, compare once it reports done.
  const rulesBefore = useRef(0)

  useEffect(() => {
    if (phase !== 'running' || scopeRun?.done !== true || api === null) return
    let cancelled = false
    void api
      .scopeRules()
      .then((rows) => {
        if (!cancelled) setRulesAdded(Math.max(0, rows.length - rulesBefore.current))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setPhase('done')
          onApplied(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [phase, scopeRun?.done, api, onApplied])

  const submitManual = async (): Promise<void> => {
    const trimmed = pattern.trim()
    if (trimmed === '' || api === null) return
    setBusy(true)
    setError(null)
    try {
      const { rejudged } = await api.addScopeRule({
        effect,
        pattern: trimmed,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      onApplied(rejudged)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitAi = async (): Promise<void> => {
    if (scope.trim() === '' || client === null || api === null) return
    setBusy(true)
    setError(null)
    try {
      rulesBefore.current = (await api.scopeRules().catch(() => [])).length
      const { runId: id } = await scopeApi(client).parse({
        scope: scope.trim(),
        ...(defaultAgent !== null ? { agent: defaultAgent } : {}),
      })
      beginScopeRun(id)
      setRunId(id)
      setPhase('running')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const targetsAdded = scopeRun?.summary?.total ?? 0
  const canSubmit = tab === 'manual' ? pattern.trim() !== '' : scope.trim() !== ''

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-[2px]"
      onClick={() => phase !== 'running' && !busy && onClose()}
    >
      <div
        className="flex max-h-[88vh] w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add scope rule"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="text-[15px] font-medium">Add to scope</div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
            disabled={busy || phase === 'running'}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        {phase === 'form' && (
          <div
            className="flex shrink-0 items-center gap-1 border-b border-border px-5 py-2.5"
            role="tablist"
            aria-label="Add scope rule mode"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id)
                  setError(null)
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  tab === t.id ? 'selected-surface' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-5">
          {phase === 'running' ? (
            <RunningPage scopeRun={scopeRun} />
          ) : phase === 'done' ? (
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Check className="size-4" strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-[14px] font-medium">
                  {rulesAdded} {rulesAdded === 1 ? 'rule' : 'rules'} added
                </div>
                <div className="text-[12.5px] text-muted-foreground">
                  {targetsAdded} {targetsAdded === 1 ? 'target' : 'targets'} recorded from the same paste
                  {scopeRun?.error === true ? ' · the agent did not finish' : ''}
                </div>
              </div>
            </div>
          ) : tab === 'manual' ? (
            <>
              <FieldLabel>Effect</FieldLabel>
              <div
                role="group"
                aria-label="Effect"
                className="mb-3 flex w-fit overflow-hidden rounded-md border border-border"
              >
                {(['include', 'exclude'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={effect === value}
                    onClick={() => setEffect(value)}
                    className={cn(
                      'px-3 py-1.5 text-[13px] capitalize',
                      effect === value ? 'bg-surface-3 font-medium' : 'text-muted-foreground hover:bg-surface-2',
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>

              <FieldLabel htmlFor="scope-pattern">Pattern</FieldLabel>
              <Input
                id="scope-pattern"
                ref={patternRef}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitManual()}
                placeholder="*.example.com · example.com · 10.0.0.0/8 · */admin/*"
                className="mb-3 font-mono text-[13px]"
              />

              <FieldLabel htmlFor="scope-note">Note</FieldLabel>
              <Input
                id="scope-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitManual()}
                placeholder="Why this rule exists, quoted from the program if you can"
                className="text-[13px]"
              />
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                An exclusion always wins over an inclusion that also matches.
              </p>
            </>
          ) : (
            <>
              <FieldLabel htmlFor="scope-paste">Scope</FieldLabel>
              <textarea
                id="scope-paste"
                className={TEXTAREA_CLASS}
                rows={9}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder={'*.example.com\napi.example.com\n10.0.0.0/24\n\nOut of scope: shop.example.com (third party)'}
              />
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                Paste the scope from HackerOne/Bugcrowd/etc. The agent writes the include and exclude rules, then
                records the hosts it lists.
              </p>
            </>
          )}

          {error !== null && phase === 'form' && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {phase === 'done' ? (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          ) : phase === 'running' ? (
            <Button size="sm" variant="ghost" disabled>
              <Loader2 className="size-4 animate-spin" /> Working…
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {tab === 'manual' ? (
                <Button size="sm" disabled={busy || !canSubmit} onClick={() => void submitManual()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" strokeWidth={2} />}
                  Add rule
                </Button>
              ) : (
                <Button size="sm" disabled={busy || !canSubmit} onClick={() => void submitAi()}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" strokeWidth={1.75} />
                  )}
                  Parse with AI
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
