import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../ui/button.js'
import { DialogFooter } from '../../ui/dialog.js'
import { Spinner } from '../../ui/spinner.js'
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
    <DialogFooter>
      {props.phase === 'done' ? (
        <Button size="sm" onClick={props.onClose}>
          Start working
        </Button>
      ) : props.phase === 'running' ? (
        <Button size="sm" variant="ghost" disabled>
          <Spinner /> Working…
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={props.busy}>
            Cancel
          </Button>
          {props.tab === 'ai' && (
            <Button size="sm" disabled={props.busy || !props.canCreate} onClick={props.onSubmitAi}>
              {props.busy ? <Spinner /> : <Sparkles className="size-4" strokeWidth={1.75} />}
              Create with AI
            </Button>
          )}
          {props.tab === 'manual' && (
            <Button size="sm" disabled={props.busy || !props.canCreate} onClick={props.onSubmitManual}>
              {props.busy && <Spinner />}
              Create engagement
            </Button>
          )}
          {props.tab === 'open' && (
            <Button size="sm" disabled={props.busy || props.dir === undefined} onClick={props.onSubmitOpen}>
              {props.busy && <Spinner />}
              Open
            </Button>
          )}
        </>
      )}
    </DialogFooter>
  )
}
