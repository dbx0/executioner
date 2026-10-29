import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Crosshair, Globe, Link2, Network, RotateCw, Server } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { targetsApi, type TargetNode, type TargetDetail, type TargetFact } from '../../api/targets.js'
import { setTargetDrag } from '../../lib/target-drag.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { cn } from '../../lib/utils.js'

/** Brand-ish glyph per target kind so the tree reads at a glance. */
function kindIcon(kind: string): LucideIcon {
  const k = kind.toLowerCase()
  if (k === 'domain' || k === 'subdomain') return Globe
  if (k === 'url') return Link2
  if (k === 'cidr' || k === 'netblock') return Network
  if (k === 'ip' || k === 'host') return Server
  return Crosshair
}

/** Condense a fact's data object into a short `key=value · key=value` line. */
function summariseFact(fact: TargetFact): string {
  const parts = Object.entries(fact.data)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  const joined = parts.join(' · ')
  return joined.length > 140 ? `${joined.slice(0, 139)}…` : joined
}

/** One tree row: an expander (when it has children), a kind icon, and the value.
 *  Draggable so it can be dropped into a terminal as a reference. */
function TargetRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: TargetNode
  depth: number
  expanded: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (node: TargetNode) => void
}): JSX.Element {
  const Icon = kindIcon(node.kind)
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.id)
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'target', text: node.value, target: node.value })}
        onClick={() => {
          onSelect(node)
          if (hasChildren) onToggle(node.id)
        }}
        title={`${node.value} — drag into a terminal to reference`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={cn(
          'group flex h-7 cursor-grab items-center gap-1 rounded-md pr-2 text-[12.5px] transition-colors active:cursor-grabbing',
          isSelected
            ? 'selected-surface text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-surface-2',
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            isOpen && 'rotate-90',
            !hasChildren && 'invisible',
          )}
          strokeWidth={2}
        />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{node.value}</span>
        {hasChildren && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{node.children.length}</span>
        )}
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <TargetRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The details of the selected target: metadata plus its facts. Each row is
 *  draggable into a terminal as a reference. */
function TargetDetailPane({ detail }: { detail: TargetDetail }): JSX.Element {
  const Icon = kindIcon(detail.kind)
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <div
        draggable
        onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'target', text: detail.value, target: detail.value })}
        title="Drag into a terminal to reference"
        className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{detail.value}</span>
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {detail.kind}
        </span>
      </div>

      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="text-muted-foreground">Source</span>
        <span className="truncate">{detail.source}</span>
        <span className="text-muted-foreground">First seen</span>
        <span className="truncate">{new Date(detail.firstSeen).toLocaleString()}</span>
        <span className="text-muted-foreground">Last seen</span>
        <span className="truncate">{new Date(detail.lastSeen).toLocaleString()}</span>
      </div>

      <div>
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Facts {detail.facts.length > 0 && `(${detail.facts.length})`}
        </div>
        {detail.facts.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">No facts collected yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {detail.facts.map((fact) => {
              const summary = summariseFact(fact)
              const text = `${detail.value} ${fact.kind}: ${summary}`
              return (
                <div
                  key={fact.id}
                  draggable
                  onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'fact', text, target: detail.value })}
                  title="Drag into a terminal to reference"
                  className="flex cursor-grab flex-col rounded-md px-2 py-1 hover:bg-surface-2 active:cursor-grabbing"
                >
                  <span className="truncate text-[11.5px] text-muted-foreground">{fact.kind}</span>
                  {summary !== '' && <span className="truncate text-[11px] text-muted-foreground">{summary}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The Targets panel: a navigable tree of the engagement's targets (roots →
 * subdomains / IPs under a CIDR, etc.) plus a details pane for the selected one.
 * Any row — a target, a sub-target, or a fact — can be dragged into a terminal
 * to reference it in the agent conversation (the terminal writes the reference
 * into the prompt; an agent can then resolve it via the MCP get_target tool).
 */
export function TargetsPanel(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])
  const [tree, setTree] = useState<TargetNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TargetDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (api === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .tree()
      .then((rows) => !cancelled && setTree(rows))
      .catch(() => !cancelled && setError('Couldn’t load targets.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [api, nonce])

  // The tree stays on screen while the refetch lands; the skeleton only shows when it is empty.
  useEngineChange(['targets', 'scope'], () => setNonce((n) => n + 1))

  // Fetch the selected target's details (metadata + facts).
  useEffect(() => {
    if (api === null || selectedId === null) {
      setDetail(null)
      return
    }
    let cancelled = false
    api
      .get(selectedId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null))
    return () => {
      cancelled = true
    }
  }, [api, selectedId])

  const toggle = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (client === null) {
    return (
      <div className="grid h-full place-items-center px-3 text-center text-[12.5px] text-muted-foreground">
        Open an engagement
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Targets</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh targets"
        >
          <RotateCw className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      {loading && tree.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">Loading…</p>
      ) : error !== null ? (
        <p className="px-2.5 py-1 text-[12px] text-status-error">{error}</p>
      ) : tree.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">No targets yet.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1 px-2 pb-1">
            <div className="flex flex-col gap-0.5">
              {tree.map((node) => (
                <TargetRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selectedId={selectedId}
                  onToggle={toggle}
                  onSelect={(n) => setSelectedId(n.id)}
                />
              ))}
            </div>
          </ScrollArea>

          {detail !== null && (
            <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-sidebar-border scrollbar-sleek">
              <TargetDetailPane detail={detail} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
