import type { JSX } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '../../ui/button.js'
import type { Phase, TabId } from './constants.js'

/** The modal's action row: its buttons depend on both the phase and the tab. */
export function ModalFooter(props: {
  phase: Phase
  tab: TabId
  busy: boolean
  canCreate: boolean
  dir: string | undefined
  onClose: () => void
  onSubmitAi: () => void
  onSubmitManual: () => void
  onSubmitOpen: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
      {props.phase === 'done' ? (
        <Button size="sm" onClick={props.onClose}>
          Start working
        </Button>
      ) : props.phase === 'running' ? (
        <Button size="sm" variant="ghost" disabled>
          <Loader2 className="size-4 animate-spin" /> Working…
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={props.busy}>
            Cancel
          </Button>
          {props.tab === 'ai' && (
            <Button size="sm" disabled={props.busy || !props.canCreate} onClick={props.onSubmitAi}>
              {props.busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" strokeWidth={1.75} />}
              Create with AI
            </Button>
          )}
          {props.tab === 'manual' && (
            <Button size="sm" disabled={props.busy || !props.canCreate} onClick={props.onSubmitManual}>
              {props.busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Create engagement
            </Button>
          )}
          {props.tab === 'open' && (
            <Button size="sm" disabled={props.busy || props.dir === undefined} onClick={props.onSubmitOpen}>
              Open
            </Button>
          )}
        </>
      )}
    </div>
  )
}
