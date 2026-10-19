import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Loader2, Plus, X } from 'lucide-react'
import { useApp } from '../../store.js'
import { Button } from '../../components/ui/button.js'
import { CustomNodesDialog } from '../../components/modals/CustomNodesDialog.js'
import { nodesApi } from '../../api/nodes.js'
import { buildCatalog, categoryColor, type CatalogEntry } from '../../lib/node-catalog.js'
import type { ParamSpec } from '../../components/canvas/ParamDrawer.js'
import { PageHeading } from './parts.js'

/** Title-case a target kind for display (ip → IP, url → URL, cidr → CIDR). */
function targetKindLabel(kind: string): string {
  const upper = new Set(['ip', 'url', 'cidr', 'dns', 'http'])
  if (upper.has(kind)) return kind.toUpperCase()
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** A readable type label for a parameter. */
function paramTypeLabel(p: ParamSpec): string {
  if (p.oneOf !== undefined) return 'Options'
  if (p.type === 'boolean') return 'Boolean'
  if (p.type === 'number') return 'Number'
  return 'Text'
}

/** Control-flow, trigger, save, and agent nodes are workflow plumbing, not
 *  capability nodes — hide them here (they still live in the canvas palette). */
const EXCLUDE_KINDS = new Set([
  'manual',
  'schedule',
  'on_create',
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
    <div className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(entry.category) }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{entry.label}</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {entry.category}
          </span>
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

/** A labeled section inside the details modal. */
function DetailBlock({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** Small pill for a value like a target kind or an output field. */
function Chip({ children, mono = false }: { children: React.ReactNode; mono?: boolean }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground ${mono ? 'font-mono' : ''}`}
    >
      {children}
    </span>
  )
}

/** The node details modal: description, input, parameters, and output. */
function NodeDetailsModal({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }): JSX.Element {
  const accepts = entry.accepts ?? []
  const outputs = entry.outputs ?? []
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(entry.category) }} aria-hidden />
          <span className="text-[14px] font-semibold">{entry.label}</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {entry.category}
          </span>
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">{entry.type}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scrollbar-sleek px-4 py-4">
          <DetailBlock title="Description">
            <p className="text-[13px] text-foreground">{entry.description ?? 'No description provided.'}</p>
          </DetailBlock>

          <DetailBlock title="Input">
            {accepts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {accepts.map((k) => (
                  <Chip key={k}>{targetKindLabel(k)}</Chip>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">Runs against the workflow target and any upstream node output.</p>
            )}
          </DetailBlock>

          <DetailBlock title="Parameters">
            {entry.params.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No parameters.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {entry.params.map((p) => (
                  <div key={p.name} className="flex flex-col gap-1 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12.5px] font-medium">{p.name}</span>
                      <Chip>{paramTypeLabel(p)}</Chip>
                      {p.required === true && (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-destructive">
                          Required
                        </span>
                      )}
                      {p.default !== undefined && p.default !== '' && (
                        <span className="text-[11px] text-muted-foreground">
                          Default: <span className="font-mono">{String(p.default)}</span>
                        </span>
                      )}
                    </div>
                    {p.description !== undefined && p.description !== '' && (
                      <p className="text-[12px] text-muted-foreground">{p.description}</p>
                    )}
                    {p.oneOf !== undefined && p.oneOf.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.oneOf.map((o) => (
                          <Chip key={String(o)} mono>
                            {String(o)}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DetailBlock>

          <DetailBlock title="Output">
            {outputs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {outputs.map((o) => (
                  <Chip key={o} mono>
                    {o}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">Structured output varies by result.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Reference a field downstream as <span className="font-mono">{'{{ nodes.<id>.<field> }}'}</span>, or the raw text as{' '}
              <span className="font-mono">{'{{ nodes.<id>.output }}'}</span>.
            </p>
          </DetailBlock>
        </div>

        <div className="flex items-center justify-end border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
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
        <p className="text-[12px] text-muted-foreground">
          {entries === null ? 'Loading…' : `${total} node${total === 1 ? '' : 's'} available to your workflows`}
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowCustom(true)}>
          <Plus className="mr-1.5 size-3.5" /> Create custom node
        </Button>
      </div>

      {entries === null ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading nodes…
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground">No nodes available.</p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          {groups.map((g) => (
            <div key={g.category}>
              <div className="border-b border-border bg-surface-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.category}
              </div>
              {g.list.map((e) => (
                <NodeRow key={e.type} entry={e} onView={() => setDetail(e)} />
              ))}
            </div>
          ))}
        </div>
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
        <p className="text-xs text-muted-foreground">Open an engagement to see the available nodes.</p>
      ) : (
        <NodesBody client={client} />
      )}
    </div>
  )
}
