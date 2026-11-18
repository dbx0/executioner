import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.js'
import { useEngineChange } from '../lib/engine-changes.js'
import { findingsApi, statusLabel, type Finding, type FindingInput } from '../api/findings.js'
import { targetsApi } from '../api/targets.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody } from '../components/ui/page.js'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { notify } from '../lib/toast.js'
import { useFlashIds } from '../components/targets/VirtualTargetTree.js'
import { FindingList } from './findings/FindingList.js'
import { FindingListSkeleton } from './findings/FindingListSkeleton.js'
import { FindingsToolbar } from './findings/FindingsToolbar.js'
import { FindingDetail } from './findings/FindingDetail.js'
import { FindingDetailSkeleton } from './findings/FindingDetailSkeleton.js'

/** Matches the 1600ms enter-down-flash-red animation, so the highlight is not cut off mid-fade. */
const NEW_FLASH_MS = 1600

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

  const activeRoot = useApp((s) => s.activeRoot)
  const [findings, setFindings] = useState<Finding[]>([])
  // Which engagement and filter the list belongs to, so a switch never diffs against the old one.
  const [listKey, setListKey] = useState<string | null>(null)
  const [targetValues, setTargetValues] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  /** First load done (success or failure). Until then the list shows placeholders
   *  rather than the empty state, which otherwise claims there is nothing here. */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Finding | null>(null)
  /** Give the open finding the whole page, list column and all. A full write-up
   *  is a document, and reading one in a 400px-narrower column is the worse half
   *  of the trade. Only honoured while a finding is open, or expanding would
   *  leave the page with nothing on it and no way back. */
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [creating, setCreating] = useState(false)
  /** The finding whose delete is in flight, so its button can say so. */
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      setListKey(`${activeRoot}\0${statusFilter}`)
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
  }, [api, statusFilter, activeRoot])

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

  const currentKey = `${activeRoot}\0${statusFilter}`
  const newIds = useFlashIds(
    useMemo(() => (listKey === currentKey ? findings.map((f) => f.id) : []), [findings, listKey, currentKey]),
    currentKey,
    listKey === currentKey,
    NEW_FLASH_MS,
  )

  const selected = findings.find((f) => f.id === selectedId) ?? null
  const listHidden = expanded && selected !== null

  // Client-side search over the loaded (status-filtered) findings: title, the two
  // text bodies, severity, status and the target's name. It narrows the list the
  // operator is already looking at, so it stays instant and needs no round-trip.
  const trimmedQuery = query.trim().toLowerCase()
  const visibleFindings = useMemo(() => {
    if (trimmedQuery === '') return findings
    return findings.filter((f) => {
      const target = f.targetId === null ? '' : (targetValues[f.targetId] ?? '')
      return (
        f.title.toLowerCase().includes(trimmedQuery) ||
        f.description.toLowerCase().includes(trimmedQuery) ||
        f.details.toLowerCase().includes(trimmedQuery) ||
        f.severity.toLowerCase().includes(trimmedQuery) ||
        statusLabel(f.status).toLowerCase().includes(trimmedQuery) ||
        target.toLowerCase().includes(trimmedQuery)
      )
    })
  }, [findings, trimmedQuery, targetValues])

  const create = async (): Promise<void> => {
    if (api === null) return
    setCreating(true)
    try {
      const created = await api.create({ title: 'New finding', severity: 'medium' }).catch(() => null)
      if (created === null) {
        setError('Could not create the finding.')
        return
      }
      await refresh()
      setSelectedId(created.id)
    } finally {
      setCreating(false)
    }
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
      notify.success(`Report written to ${written.relativePath}`)
      setError(null)
    } catch {
      setError('Could not write the report.')
    } finally {
      setExporting(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (api === null) return
    setDeletingId(id)
    try {
      await api.remove(id).catch(() => setError('Could not delete the finding.'))
      if (selectedId === id) setSelectedId(null)
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  const pending = selectedId !== null && selected === null && (!loadedOnce || loading)

  return (
    // The shell provides tooltips too; this one keeps the page renderable on its own.
    <TooltipProvider delayDuration={300}>
      <Page>
        <FindingsToolbar
          count={trimmedQuery === '' ? String(findings.length) : `${visibleFindings.length} of ${findings.length}`}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          loading={loading}
          exporting={exporting}
          creating={creating}
          onStatusFilterChange={setStatusFilter}
          onRefresh={() => void refresh()}
          onExport={() => void exportReport()}
          onCreate={() => void create()}
        />

        {error !== null && (
          <p
            role="alert"
            className="mb-panel break-words rounded-panel border border-glass-border bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-4 py-2 text-[12px] text-status-error"
          >
            {error}
          </p>
        )}

        <PageBody>
          {!listHidden && (
            <GlassPanel data-tour="findings-list" className="flex w-[400px] shrink-0 flex-col">
              {loadedOnce ? (
                trimmedQuery !== '' && visibleFindings.length === 0 && findings.length > 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No findings match “{query.trim()}”.</p>
                ) : (
                  <FindingList
                    findings={visibleFindings}
                    selectedId={selectedId}
                    targetValues={targetValues}
                    newIds={newIds}
                    onSelect={setSelectedId}
                  />
                )
              ) : (
                <FindingListSkeleton />
              )}
            </GlassPanel>
          )}

          {selected !== null ? (
            <FindingDetail
              key={selected.id}
              finding={selected}
              targetValue={selected.targetId === null ? null : (targetValues[selected.targetId] ?? selected.targetId)}
              saving={saving}
              deleting={deletingId === selected.id}
              expanded={expanded}
              onToggleExpand={() => setExpanded(!expanded)}
              onSave={(patch) => void save(selected.id, patch)}
              onDelete={() => setConfirmDelete(selected)}
            />
          ) : pending ? (
            <FindingDetailSkeleton />
          ) : (
            <GlassPanel className="flex min-w-0 flex-1 items-center justify-center">
              <p className="text-[13px] text-muted-foreground">Select a finding to read it.</p>
            </GlassPanel>
          )}
        </PageBody>

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
      </Page>
    </TooltipProvider>
  )
}
