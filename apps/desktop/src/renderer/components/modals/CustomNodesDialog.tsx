import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { customNodesApi, type CustomNode } from '../../api/custom-nodes.js'
import { Button } from '../ui/button.js'
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
  const [nodes, setNodes] = useState<CustomNode[]>([])
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
      .catch(() => {})
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
    await api.remove(id).catch(() => {})
    if (form.editingId === id) setForm(empty)
    refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[14px] font-medium">Custom nodes</div>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <SavedNodesList
            nodes={nodes}
            editingId={form.editingId}
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
      </div>
    </div>
  )
}
