import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crosshair, Globe, Link2, Network, Server } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { targetsApi, type TargetNode, type TargetDetail, type TargetFact } from '../../api/targets.js'
import { setTargetDrag } from '../../lib/target-drag.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { cn } from '../../lib/utils.js'
import { TargetTreeSkeleton } from '../targets/TargetTreeSkeleton.js'
import { useFlashIds } from '../targets/VirtualTargetTree.js'
import { Panel, PanelNote, PanelRefresh, PanelRow, PanelSection } from './panel-parts.js'

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

function collectIds(nodes: TargetNode[], into: string[] = []): string[] {
  for (const n of nodes) {
    into.push(n.id)
    collectIds(n.children, into)
  }
  return into
}

/** One tree row: an expander (when it has children), a kind icon, and the value.
 *  Draggable so it can be dropped into a terminal as a reference. */
function TargetRow({
  node,
  depth,
  expanded,
  selectedId,
  newIds,
  onToggle,
  onSelect,
}: {
  node: TargetNode
  depth: number
  expanded: Set<string>
  selectedId: string | null
  newIds: ReadonlySet<string>
  onToggle: (id: string) => void
  onSelect: (node: TargetNode) => void
}): JSX.Element {
  const Icon = kindIcon(node.kind)
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.id)
  const isSelected = selectedId === node.id
  const isNew = newIds.has(node.id)

  return (
    <div>
      <PanelRow
        draggable
        data-new={isNew ? 'true' : undefined}
        onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'target', text: node.value, target: node.value })}
        onClick={() => {
          onSelect(node)
          if (hasChildren) onToggle(node.id)
        }}
        title={`${node.value}: drag into a terminal to reference`}
        depth={depth}
        selected={isSelected}
        chevron={!hasChildren ? 'none' : isOpen ? 'open' : 'closed'}
        aria-expanded={hasChildren ? isOpen : undefined}
        icon={<Icon className="size-3.5 shrink-0" strokeWidth={1.75} />}
        label={node.value}
        trailing={
          hasChildren ? <span className="shrink-0 text-[10px] tabular-nums text-tertiary-foreground">{node.children.length}</span> : undefined
        }
        className={cn('cursor-grab font-mono text-[11.5px] active:cursor-grabbing', isNew && 'motion-safe:animate-enter-flash-amber')}
      />
      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <TargetRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              newIds={newIds}
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
    <div className="flex flex-col gap-2 px-1.5 py-2">
      <div
        draggable
        onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'target', text: detail.value, target: detail.value })}
        title="Drag into a terminal to reference"
        className="flex cursor-grab items-center gap-2 px-2 active:cursor-grabbing"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{detail.value}</span>
        <span className="shrink-0 rounded-control bg-glass-strong px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {detail.kind}
        </span>
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 px-2 text-[11px] text-muted-foreground">
        <dt className="text-tertiary-foreground">Source</dt>
        <dd className="truncate">{detail.source}</dd>
        <dt className="text-tertiary-foreground">First seen</dt>
        <dd className="truncate">{new Date(detail.firstSeen).toLocaleString()}</dd>
        <dt className="text-tertiary-foreground">Last seen</dt>
        <dd className="truncate">{new Date(detail.lastSeen).toLocaleString()}</dd>
      </dl>

      <div>
        <PanelSection count={detail.facts.length}>Facts</PanelSection>
        {detail.facts.length === 0 ? (
          <PanelNote>No facts collected yet.</PanelNote>
        ) : (
          <div className="flex flex-col gap-0.5">
            {detail.facts.map((fact) => {
              const summary = summariseFact(fact)
              const text = `${detail.value} ${fact.kind}: ${summary}`
              return (
                <PanelRow
                  key={fact.id}
                  draggable
                  onDragStart={(e) => setTargetDrag(e.dataTransfer, { kind: 'fact', text, target: detail.value })}
                  title="Drag into a terminal to reference"
                  label={fact.kind}
                  detail={summary === '' ? undefined : summary}
                  className="cursor-grab hover:bg-glass-strong active:cursor-grabbing"
                />
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
  const activeRoot = useApp((s) => s.activeRoot)
  const [tree, setTree] = useState<TargetNode[]>([])
  // Which engagement the tree belongs to, so a switch never diffs against the old one.
  const [treeRoot, setTreeRoot] = useState<string | null>(null)
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
      .then((rows) => {
        if (cancelled) return
        setTree(rows)
        setTreeRoot(activeRoot)
      })
      .catch(() => !cancelled && setError('Couldn’t load targets.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [api, nonce, activeRoot])

  // The tree stays on screen while the refetch lands; the skeleton only shows when it is empty.
  useEngineChange(['targets', 'scope'], () => setNonce((n) => n + 1))

  const allIds = useMemo(() => (treeRoot === activeRoot ? collectIds(tree) : []), [tree, treeRoot, activeRoot])
  const newIds = useFlashIds(allIds, activeRoot, treeRoot !== null && treeRoot === activeRoot)

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
      <Panel title="Targets">
        <PanelNote fill>Open an engagement</PanelNote>
      </Panel>
    )
  }

  return (
    <Panel
      title="Targets"
      meta={allIds.length > 0 ? allIds.length : undefined}
      actions={<PanelRefresh label="Refresh targets" loading={loading} onClick={() => setNonce((n) => n + 1)} />}
    >
      {loading && tree.length === 0 ? (
        <TargetTreeSkeleton />
      ) : error !== null ? (
        <PanelNote tone="error">{error}</PanelNote>
      ) : tree.length === 0 ? (
        <PanelNote>No targets yet.</PanelNote>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1 px-1.5 pb-1">
            <div className="flex flex-col gap-0.5">
              {tree.map((node) => (
                <TargetRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selectedId={selectedId}
                  newIds={newIds}
                  onToggle={toggle}
                  onSelect={(n) => setSelectedId(n.id)}
                />
              ))}
            </div>
          </ScrollArea>

          {detail !== null && (
            <div className="scrollbar-sleek max-h-[45%] shrink-0 overflow-y-auto border-t border-glass-border">
              <TargetDetailPane detail={detail} />
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
