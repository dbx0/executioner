import type { JSX } from 'react'
import { useState } from 'react'
import { WorkflowsHub } from './WorkflowsHub.js'
import { WorkflowEditor } from './WorkflowEditor.js'

/**
 * The Workflows/Agents section. It has two internal modes: the hub (a landing
 * page with a Workflows tab and an Agents tab, driven by the sidebar) and the
 * editor (the workflow canvas). The editor is always reached from the hub —
 * creating a new workflow or opening an existing one — never as its own sidebar
 * entry. Remounting the editor per workflow (via `key`) gives it fresh state
 * each time the hub opens one.
 */
type Mode = { kind: 'hub' } | { kind: 'editor'; workflowId: string | 'new' }

export function WorkflowsView(): JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: 'hub' })

  if (mode.kind === 'editor') {
    return <WorkflowEditor key={mode.workflowId} workflowId={mode.workflowId} onBack={() => setMode({ kind: 'hub' })} />
  }

  return (
    <WorkflowsHub
      onCreate={() => setMode({ kind: 'editor', workflowId: 'new' })}
      onOpen={(id) => setMode({ kind: 'editor', workflowId: id })}
    />
  )
}
