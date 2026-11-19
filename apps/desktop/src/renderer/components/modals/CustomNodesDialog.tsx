import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { customNodesApi, type CustomNode } from '../../api/custom-nodes.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogHeader } from '../ui/dialog.js'
import { CustomNodeEditor } from './custom-nodes/CustomNodeEditor.js'
import { SavedNodesList } from './custom-nodes/SavedNodesList.js'
import { apiError, empty, toForm, toInput, type FormState } from './custom-nodes/form-state.js'

export function CustomNodesDialog({
  client,
  onClose,
  onChanged,
}: {
  client: AxiosInstance
  onClose: () => void
  onChanged?: (nodes: CustomNode[]) => void
}): JSX.Element {
  const api = customNodesApi(client)
  // Null until the first list arrives, so the rail shows a skeleton and not "none yet".
  const [nodes, setNodes] = useState<CustomNode[] | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(empty)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void api
      .list()
      .then((list) => {
        setNodes(list)
        onChanged?.(list)
      })
      .catch(() => setNodes((prev) => prev ?? []))
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<FormState>): void => setForm((f) => ({ ...f, ...patch }))

  const valid =
    /^[a-z0-9][a-z0-9-]*$/.test(form.id.trim()) &&
    form.name.trim() !== '' &&
    form.description.trim() !== '' &&
    form.program.trim() !== '' &&
    form.accepts.trim() !== ''

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const input = toInput(form)
      if (form.editingId === undefined) await api.create(input)
      else await api.update(form.editingId, input)
      setForm(empty)
      refresh()
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setRemovingId(id)
    await api.remove(id).catch(() => {})
    setRemovingId(null)
    if (form.editingId === id) setForm(empty)
    refresh()
  }

  return (
    <Dialog onClose={onClose} size="lg">
      <DialogHeader
        title="Custom nodes"
        actions={
          <Button variant="glass" size="sm" onClick={onClose}>
            Done
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1">
        <SavedNodesList
          nodes={nodes}
          editingId={form.editingId}
          removingId={removingId}
          onEdit={(n) => setForm(toForm(n))}
          onRemove={(id) => void remove(id)}
        />

        <CustomNodeEditor
          form={form}
          set={set}
          error={error}
          valid={valid}
          busy={busy}
          onNew={() => setForm(empty)}
          onSave={() => void save()}
        />
      </div>
    </Dialog>
  )
}
