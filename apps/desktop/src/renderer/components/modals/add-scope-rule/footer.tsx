import type { JSX } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { Button } from '../../ui/button.js'
import { DialogFooter } from '../../ui/dialog.js'
import { Spinner } from '../../ui/spinner.js'

export type Phase = 'form' | 'running' | 'review' | 'done'
export type Tab = 'manual' | 'ai'

/** The action row: its buttons follow the phase, then the tab. */
export function ScopeRuleFooter(props: {
  phase: Phase
  tab: Tab
  busy: boolean
  canSubmit: boolean
  /** The review step has something to add. */
  canApply: boolean
  onClose: () => void
  onSubmitManual: () => void
  onSubmitAi: () => void
  onApply: () => void
}): JSX.Element {
  const { phase, busy } = props
  return (
    <DialogFooter>
      {phase === 'done' ? (
        <Button size="sm" onClick={props.onClose}>
          Done
        </Button>
      ) : phase === 'review' ? (
        props.canApply ? (
          <>
            <Button variant="ghost" size="sm" onClick={props.onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={props.onApply}>
              {busy ? <Spinner /> : <Plus className="size-4" strokeWidth={2} />}
              Add
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={props.onClose}>
            Close
          </Button>
        )
      ) : phase === 'running' ? (
        <Button size="sm" variant="ghost" disabled>
          <Spinner /> Working…
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          {props.tab === 'manual' ? (
            <Button size="sm" disabled={busy || !props.canSubmit} onClick={props.onSubmitManual}>
              {busy ? <Spinner /> : <Plus className="size-4" strokeWidth={2} />}
              Add rule
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !props.canSubmit} onClick={props.onSubmitAi}>
              {busy ? <Spinner /> : <Sparkles className="size-4" strokeWidth={1.75} />}
              Parse with AI
            </Button>
          )}
        </>
      )}
    </DialogFooter>
  )
}
