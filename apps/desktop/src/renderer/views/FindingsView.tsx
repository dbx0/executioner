import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Plus, RefreshCw } from 'lucide-react'
import { useApp } from '../store.js'
import { useEngineChange } from '../lib/engine-changes.js'
import { findingsApi, statusLabel, STATUSES, type Finding, type FindingInput } from '../api/findings.js'
import { targetsApi } from '../api/targets.js'
import { Button } from '../components/ui/button.js'
import { Select } from '../components/ui/select.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { FindingList } from './findings/FindingList.js'
import { FindingListSkeleton } from './findings/FindingListSkeleton.js'
import { FindingDetail } from './findings/FindingDetail.js'

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
]

/** Every Finding field is a primitive, so a shallow comparison is exact. */
function sameFinding(a: Finding, b: Finding): boolean {
  return (Object.keys(a) as (keyof Finding)[]).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length
}

/**
 * The Findings page: what the engagement has actually proved, in one place.
 * Workflows write here through `save_to_finding`, agents through the MCP tools,
 * and this page is where they get read, triaged, corrected and deleted.
 */
export function FindingsView(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : findingsApi(client)), [client])

  const [findings, setFindings] = useState<Finding[]>([])
  const [targetValues, setTargetValues] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  /** First load done (success or failure). Until then the list shows placeholders
   *  rather than the empty state, which otherwise claims there is nothing here. */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Finding | null>(null)
  /** Where the last export landed, shown until the next action replaces it. */
  const [exported, setExported] = useState<string | null>(null)
  /** Give the open finding the whole page, list column and all — a full write-up
   *  is a document, and reading one in a 384px-narrower column is the worse half
   *  of the trade. Only honoured while a finding is open, or expanding would
   *  leave the page with nothing on it and no way back. */
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)

  const refresh = useCallback(async (silent = false) => {
    if (api === null) return
    if (!silent) setLoading(true)
    try {
      const list = await api.list(statusFilter === 'all' ? {} : { status: statusFilter })
      // Keep the existing object for any row whose content is identical, so the open
      // finding's editor does not take the refresh for a new finding and drop
      // the operator's unsaved draft.
      setFindings((prev) => {
        const old = new Map(prev.map((f) => [f.id, f]))
        return list.map((f) => {
          const same = old.get(f.id)
          return same !== undefined && sameFinding(same, f) ? same : f
        })
      })
      setError(null)
    } catch {
      if (!silent) setFindings([])
      setError('Could not load findings.')
    } finally {
      // A silent refresh never started the spinner, so it must not stop one a
      // manual refresh still owns.
      if (!silent) setLoading(false)
      setLoadedOnce(true)
    }
  }, [api, statusFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live refresh keeps the rows, the selection and the scroll where they are.
  useEngineChange(['findings'], () => void refresh(true))

  // A deep link from a target's panel: show that finding, and clear any filter
  // that would have hidden it. Consumed once, like the other pending-id links.
  const pendingFindingId = useApp((s) => s.pendingFindingId)
  const setPendingFindingId = useApp((s) => s.setPendingFindingId)
  useEffect(() => {
    if (pendingFindingId === null) return
    setStatusFilter('all')
    setSelectedId(pendingFindingId)
    setPendingFindingId(null)
  }, [pendingFindingId, setPendingFindingId])

  // Target ids mean nothing on screen; show the asset they name.
  useEffect(() => {
    if (client === null) return
    void targetsApi(client)
      .list()
      .then((list) => setTargetValues(Object.fromEntries(list.map((t) => [t.id, t.value]))))
      .catch(() => setTargetValues({}))
  }, [client])

  const selected = findings.find((f) => f.id === selectedId) ?? null
  const listHidden = expanded && selected !== null

  const create = async (): Promise<void> => {
    if (api === null) return
    const created = await api.create({ title: 'New finding', severity: 'medium' }).catch(() => null)
    if (created === null) {
      setError('Could not create the finding.')
      return
    }
    await refresh()
    setSelectedId(created.id)
  }

  const save = async (id: string, patch: Partial<FindingInput>): Promise<void> => {
    if (api === null) return
    setSaving(true)
    try {
      await api.update(id, patch)
      await refresh()
      setError(null)
    } catch {
      setError('Could not save the finding.')
    } finally {
      setSaving(false)
    }
  }

  const exportReport = async (): Promise<void> => {
    if (api === null) return
    setExporting(true)
    try {
      const written = await api.report(statusFilter === 'all' ? {} : { status: statusFilter })
      setExported(written.relativePath)
      setError(null)
    } catch {
      setExported(null)
      setError('Could not write the report.')
    } finally {
      setExporting(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (api === null) return
    await api.remove(id).catch(() => setError('Could not delete the finding.'))
    if (selectedId === id) setSelectedId(null)
    await refresh()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-[13px] font-medium">Findings</span>
        <span className="text-[11px] text-muted-foreground">{findings.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={statusFilterOptions}
            ariaLabel="Filter by status"
            className="h-8 w-40"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Refresh findings" onClick={() => void refresh()}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} strokeWidth={1.75} />
          </Button>
          <Button variant="outline" size="sm" data-tour="findings-export" disabled={exporting} onClick={() => void exportReport()}>
            <FileText className="mr-1 size-3.5" strokeWidth={2} /> {exporting ? 'Exporting…' : 'Export report'}
          </Button>
          <Button size="sm" data-tour="findings-new" onClick={() => void create()}>
            <Plus className="mr-1 size-3.5" strokeWidth={2} /> New finding
          </Button>
        </div>
      </div>

      {error !== null && (
        <p className="border-b border-border px-4 py-2 text-[12px] text-status-error break-words">{error}</p>
      )}
      {exported !== null && (
        <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground break-words">
          Report written to <code className="font-mono text-foreground">{exported}</code>
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!listHidden && (
          <div data-tour="findings-list" className="flex w-96 shrink-0 flex-col overflow-hidden border-r border-border">
            {loadedOnce ? (
              <FindingList
                findings={findings}
                selectedId={selectedId}
                targetValues={targetValues}
                onSelect={setSelectedId}
              />
            ) : (
              <FindingListSkeleton />
            )}
          </div>
        )}

        {selected === null ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a finding to read it.</p>
          </div>
        ) : (
          <FindingDetail
            key={selected.id}
            finding={selected}
            targetValue={selected.targetId === null ? null : (targetValues[selected.targetId] ?? selected.targetId)}
            saving={saving}
            expanded={expanded}
            onToggleExpand={() => setExpanded(!expanded)}
            onSave={(patch) => void save(selected.id, patch)}
            onDelete={() => setConfirmDelete(selected)}
          />
        )}
      </div>

      {confirmDelete !== null && (
        <ConfirmModal
          title="Delete finding"
          message={`Delete "${confirmDelete.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id
            setConfirmDelete(null)
            void remove(id)
          }}
        />
      )}
    </div>
  )
}
