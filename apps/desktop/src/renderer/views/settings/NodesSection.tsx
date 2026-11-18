import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Plus } from 'lucide-react'
import { useApp } from '../../store.js'
import { Button } from '../../components/ui/button.js'
import { CustomNodesDialog } from '../../components/modals/CustomNodesDialog.js'
import { nodesApi } from '../../api/nodes.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { buildCatalog, type CatalogEntry } from '../../lib/node-catalog.js'
import { CategoryDot, NodeDetailsModal } from './NodeDetailsModal.js'
import { PageHeading, SettingsCard, SettingsNote, Tag } from './parts.js'

/** Control-flow, trigger, save, and agent nodes are workflow plumbing, not
 *  capability nodes: hide them here (they still live in the canvas palette). */
const EXCLUDE_KINDS = new Set([
  'manual',
  'if',
  'loop',
  'stop',
  'merge',
  'set_variable',
  'save_to_target',
  'save_to_finding',
  'agent',
])

/** One node row: a category dot, the label, its description, and View details. */
function NodeRow({ entry, onView }: { entry: CatalogEntry; onView: () => void }): JSX.Element {
  return (
    <div className="flex items-start gap-3 border-b border-glass-border px-3.5 py-2.5 last:border-b-0">
      <CategoryDot category={entry.category} className="mt-1.5 size-2" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{entry.label}</span>
          <Tag>{entry.category}</Tag>
        </div>
        {entry.description !== undefined && entry.description !== '' && (
          <div className="mt-0.5 text-xs text-muted-foreground">{entry.description}</div>
        )}
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onView}>
        View details
      </Button>
    </div>
  )
}

/** The node list while the catalog loads, in the row shape it resolves to. */
function NodeListSkeleton(): JSX.Element {
  return (
    <SettingsCard>
      <div role="status" aria-label="Loading nodes">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-3 border-b border-glass-border px-3.5 py-2.5 last:border-b-0">
            <Skeleton className="mt-1.5 size-2 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}

function NodesBody({ client }: { client: AxiosInstance }): JSX.Element {
  const api = useMemo(() => nodesApi(client), [client])
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [detail, setDetail] = useState<CatalogEntry | null>(null)

  const refresh = useCallback(() => {
    setEntries(null)
    void api
      .list()
      .then((listings) => setEntries(buildCatalog(listings).filter((e) => !EXCLUDE_KINDS.has(e.kind))))
      .catch(() => setEntries([]))
  }, [api])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Group by category (alpha), nodes alpha within each group.
  const groups = useMemo(() => {
    const byCat = new Map<string, CatalogEntry[]>()
    for (const e of entries ?? []) {
      const list = byCat.get(e.category) ?? []
      list.push(e)
      byCat.set(e.category, list)
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, list]) => ({ category, list: list.sort((a, b) => a.label.localeCompare(b.label)) }))
  }, [entries])

  const total = entries?.length ?? 0

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        {entries === null ? (
          <Skeleton className="h-3.5 w-48" />
        ) : (
          <p className="text-[12px] text-muted-foreground">{`${total} node${total === 1 ? '' : 's'} available to your workflows`}</p>
        )}
        <Button variant="glass" size="sm" onClick={() => setShowCustom(true)}>
          <Plus className="size-3.5" /> Create custom node
        </Button>
      </div>

      {entries === null ? (
        <NodeListSkeleton />
      ) : total === 0 ? (
        <SettingsNote>No nodes available.</SettingsNote>
      ) : (
        <SettingsCard>
          {groups.map((g) => (
            <div key={g.category}>
              <div className="border-b border-glass-border bg-glass px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.category}
              </div>
              {g.list.map((e) => (
                <NodeRow key={e.type} entry={e} onView={() => setDetail(e)} />
              ))}
            </div>
          ))}
        </SettingsCard>
      )}

      {showCustom && (
        <CustomNodesDialog
          client={client}
          onClose={() => {
            setShowCustom(false)
            refresh()
          }}
        />
      )}

      {detail !== null && <NodeDetailsModal entry={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

/** Settings → Nodes: every capability node available to workflows, plus custom-node authoring. */
export function NodesSection(): JSX.Element {
  const client = useApp((s) => s.client)
  return (
    <div>
      <PageHeading title="Nodes" description="The tool nodes your workflows can use. Author your own custom nodes here too." />
      {client === null ? (
        <SettingsNote>Open an engagement to see the available nodes.</SettingsNote>
      ) : (
        <NodesBody client={client} />
      )}
    </div>
  )
}
