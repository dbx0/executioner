import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useApp } from '../store.js'
import { executionsApi } from '../api/executions.js'
import type { OpenEngagement } from '../store/types.js'
import { ConfirmModal } from './modals/ConfirmModal.js'

/** How long to wait on an engine's run list before leaving runs out of the count. */
const RUNS_TIMEOUT_MS = 1000

export interface RunningCounts {
  agents: number
  terminals: number
  runs: number
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The dialog's message: what closing would stop, or that nothing is lost. */
export function closeMessage({ agents, terminals, runs }: RunningCounts): string {
  const parts = [
    agents > 0 ? plural(agents, 'agent') : null,
    terminals > 0 ? plural(terminals, 'terminal') : null,
    runs > 0 ? plural(runs, 'run') : null,
  ].filter((p): p is string => p !== null)
  if (parts.length === 0) {
    return 'Your open engagements, tabs and unsaved editor changes come back the next time you open it.'
  }
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const verb = agents + terminals + runs === 1 ? 'is' : 'are'
  return `${list} ${verb} still running. Closing Executioner stops them.`
}

/** Terminal and agent tabs across every open engagement. */
function sessionCounts(open: OpenEngagement[]): { agents: number; terminals: number } {
  let agents = 0
  let terminals = 0
  for (const e of open) {
    for (const s of e.sessions) {
      if (s.agent === 'shell') terminals += 1
      else agents += 1
    }
  }
  return { agents, terminals }
}

/** Running workflow and tool runs across every open engagement; an engine that is slow or down counts as none. */
async function runningRuns(open: OpenEngagement[]): Promise<number> {
  const counts = await Promise.all(
    open.map((e) =>
      Promise.race([
        executionsApi(e.client)
          .list()
          .then((list) => list.filter((x) => x.status === 'running').length),
        new Promise<number>((resolve) => setTimeout(() => resolve(0), RUNS_TIMEOUT_MS)),
      ]).catch(() => 0),
    ),
  )
  return counts.reduce((a, b) => a + b, 0)
}

/**
 * Asks before the app closes. Main holds every close and quit (the X, Alt+F4,
 * Cmd+Q, the taskbar) and sends `confirm-close` here; the answer goes back the
 * same way. State is already saved as it changes, so the dialog only warns
 * about what is still running.
 */
export function CloseConfirm(): JSX.Element | null {
  const [counts, setCounts] = useState<RunningCounts | null>(null)

  useEffect(() => {
    const bridge = window.executioner as Partial<Window['executioner']> | undefined
    if (bridge?.onConfirmClose === undefined) return
    return bridge.onConfirmClose(() => {
      bridge.closeConfirmShown?.()
      const open = useApp.getState().open
      setCounts({ ...sessionCounts(open), runs: 0 })
      void runningRuns(open).then((runs) => setCounts((c) => (c === null ? c : { ...c, runs })))
    })
  }, [])

  if (counts === null) return null
  const answer = (ok: boolean): void => {
    setCounts(null)
    window.executioner.answerClose(ok)
  }
  return (
    <ConfirmModal
      title="Close Executioner?"
      message={closeMessage(counts)}
      confirmLabel="Close"
      destructive
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  )
}
