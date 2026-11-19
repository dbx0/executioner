import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../../store.js'
import { targetsApi, type Rejudge } from '../../api/targets.js'
import { scopeApi, type ScopeProposal } from '../../api/scope.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogBody, DialogHeader } from '../ui/dialog.js'
import { ScopeRuleFooter, type Phase, type Tab } from './add-scope-rule/footer.js'
import { AiScopeForm, ManualRuleForm, type Effect } from './add-scope-rule/forms.js'
import { DoneSummary, ProposalReview } from './add-scope-rule/results.js'
import { ModeTabs, type ModeTab } from './mode-tabs.js'
import { RunningPage } from './new-engagement/result-pages.js'

const TABS: ModeTab<Tab>[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'ai', label: 'Start with AI' },
]

export interface AddScopeRuleModalProps {
  onClose: () => void
  /**
   * The boundary changed: reload the list. `rejudge` is how many target verdicts
   * the write moved and the split it left, or null when the caller cannot know
   * (an AI pass that ended without a proposal wrote nothing through this modal).
   */
  onApplied: (rejudge: Rejudge | null) => void
}

/**
 * Add to the engagement's boundary, either one rule at a time or by pasting the
 * program's scope and letting the default agent write the rules.
 *
 * The AI tab runs the same `/scope/parse` pass as "Start with AI" on a new
 * engagement, but in propose mode: the agent drafts the boundary and the assets,
 * and nothing is saved until the operator confirms the review step.
 */
export function AddScopeRuleModal({ onClose, onApplied }: AddScopeRuleModalProps): JSX.Element {
  const client = useApp((s) => s.client)
  const defaultAgent = useApp((s) => s.defaultAgent)
  const beginScopeRun = useApp((s) => s.beginScopeRun)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])

  const [tab, setTab] = useState<Tab>('manual')
  const [step, setStep] = useState<Phase>('form')
  const [effect, setEffect] = useState<Effect>('include')
  const [pattern, setPattern] = useState('')
  const [note, setNote] = useState('')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [rulesAdded, setRulesAdded] = useState(0)
  const [targetsRecorded, setTargetsRecorded] = useState<number | null>(null)
  const patternRef = useRef<HTMLInputElement>(null)

  const scopeRun = useApp((s) => (runId !== null ? s.scopeRuns[runId] : undefined))

  useEffect(() => {
    patternRef.current?.focus()
  }, [])

  // A proposal waits for the operator's review. A run that ended without one
  // wrote through MCP itself, so its count comes from the list: snapshot before
  // the run, compare once it reports done.
  const rulesBefore = useRef(0)
  const proposal = scopeRun?.proposal

  // A finished run with a proposal moves from running to review by itself.
  const phase: Phase = step === 'running' && scopeRun?.done === true && proposal !== undefined ? 'review' : step

  useEffect(() => {
    if (phase !== 'running' || scopeRun?.done !== true || proposal !== undefined || api === null) return
    let cancelled = false
    void api
      .scopeRules()
      .then((rows) => {
        if (!cancelled) setRulesAdded(Math.max(0, rows.length - rulesBefore.current))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setStep('done')
          onApplied(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [phase, scopeRun?.done, proposal, api, onApplied])

  const submitManual = async (): Promise<void> => {
    const trimmed = pattern.trim()
    if (trimmed === '' || api === null) return
    setBusy(true)
    setError(null)
    try {
      const { rejudged, inScope, outOfScope } = await api.addScopeRule({
        effect,
        pattern: trimmed,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      onApplied({ rejudged, inScope, outOfScope })
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
        propose: true,
        ...(defaultAgent !== null ? { agent: defaultAgent } : {}),
      })
      beginScopeRun(id)
      setRunId(id)
      setStep('running')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const applyProposal = async (reviewed: ScopeProposal): Promise<void> => {
    if (client === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await scopeApi(client).apply(reviewed)
      setRulesAdded(result.rulesAdded)
      setTargetsRecorded(result.targetsAdded)
      onApplied({ rejudged: result.rejudged, inScope: result.inScope, outOfScope: result.outOfScope })
      setStep('done')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const targetsAdded = targetsRecorded ?? scopeRun?.summary?.total ?? 0
  const emptyProposal = proposal !== undefined && proposal.rules.length === 0 && proposal.targets.length === 0
  const canSubmit = tab === 'manual' ? pattern.trim() !== '' : scope.trim() !== ''

  // A run in flight or a write in progress cannot be dismissed from under itself.
  const locked = busy || phase === 'running'

  return (
    <Dialog onClose={onClose} dismissable={!locked} label="Add scope rule" className="w-[560px]">
      <DialogHeader
        title="Add to scope"
        actions={
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} disabled={locked}>
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        }
      />

      {phase === 'form' && (
        <div className="flex shrink-0 items-center border-b border-glass-border px-5 py-2.5">
          <ModeTabs
            tabs={TABS}
            value={tab}
            onSelect={(id) => {
              setTab(id)
              setError(null)
            }}
            label="Add scope rule mode"
          />
        </div>
      )}

      <DialogBody className="py-5">
        {phase === 'running' ? (
          <RunningPage scopeRun={scopeRun} />
        ) : phase === 'review' && proposal !== undefined ? (
          emptyProposal ? (
            <p className="text-[13px] text-muted-foreground">The agent didn&apos;t find any rules in that text.</p>
          ) : (
            <ProposalReview proposal={proposal} error={error} />
          )
        ) : phase === 'done' ? (
          <DoneSummary rulesAdded={rulesAdded} targetsAdded={targetsAdded} unfinished={scopeRun?.error === true} />
        ) : tab === 'manual' ? (
          <ManualRuleForm
            effect={effect}
            setEffect={setEffect}
            pattern={pattern}
            setPattern={setPattern}
            note={note}
            setNote={setNote}
            patternRef={patternRef}
            onSubmit={() => void submitManual()}
          />
        ) : (
          <AiScopeForm scope={scope} setScope={setScope} />
        )}

        {error !== null && phase === 'form' && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </DialogBody>

      <ScopeRuleFooter
        phase={phase}
        tab={tab}
        busy={busy}
        canSubmit={canSubmit}
        canApply={proposal !== undefined && !emptyProposal}
        onClose={onClose}
        onSubmitManual={() => void submitManual()}
        onSubmitAi={() => void submitAi()}
        onApply={() => proposal !== undefined && void applyProposal(proposal)}
      />
    </Dialog>
  )
}
