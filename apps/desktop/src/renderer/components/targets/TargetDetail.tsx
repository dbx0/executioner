import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import {
  type ScreenshotItem,
  type TargetDetail,
  type TargetFact,
  type targetsApi,
} from '../../api/targets.js'
import { useApp } from '../../store.js'
import { cn } from '../../lib/utils.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { stagger } from '../../lib/motion.js'
import { SeverityChip, StatusChip } from '../../views/findings/chips.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Select, type SelectOption } from '../ui/select.js'
import { ScrollArea } from '../ui/scroll-area.js'
import {
  FACT_KIND_LABELS,
  FACT_KIND_ORDER,
  FACT_RENDERERS,
  formatDate,
  Section,
} from './fact-sections.js'
import { ScreenshotGallery } from './ScreenshotGallery.js'
import { ScopeBadge } from './ScopeBadge.js'
import { apiErrorMessage } from '../../lib/api-error.js'

const KINDS = ['domain', 'subdomain', 'ip', 'cidr', 'url'] as const

function groupByKind(facts: TargetFact[]): Map<string, TargetFact[]> {
  const map = new Map<string, TargetFact[]>()
  for (const f of facts) {
    const bucket = map.get(f.kind)
    if (bucket === undefined) map.set(f.kind, [f])
    else bucket.push(f)
  }
  return map
}

// ---------------------------------------------------------------------------
// Pure, prop-driven view
// ---------------------------------------------------------------------------

export interface TargetDetailViewProps {
  target: TargetDetail
  screenshots: ScreenshotItem[]
  onRename?: (patch: { kind?: string; value?: string }) => void
  onDelete?: () => void
  onClose?: (() => void) | undefined
  renaming?: boolean
  deleting?: boolean
  error?: string | null
}

/** This asset's findings, worst first; clicking one opens it on the Findings page. */
function TargetFindings({ findings }: { findings: TargetDetail['findings'] }): JSX.Element {
  const openFinding = useApp((st) => st.openFinding)
  if (findings.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">Nothing recorded against this target yet.</p>
  }
  return (
    <div className="flex flex-col">
      {findings.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => openFinding(f.id)}
          title="Open on the Findings page"
          className="flex w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left hover:bg-surface-1"
        >
          <SeverityChip severity={f.severity} />
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{f.title}</span>
          <StatusChip status={f.status} />
        </button>
      ))}
    </div>
  )
}

export function TargetDetailView({
  target,
  screenshots,
  onRename,
  onDelete,
  onClose,
  renaming,
  deleting,
  error,
}: TargetDetailViewProps): JSX.Element {
  const [value, setValue] = useState(target.value)
  const [kind, setKind] = useState(target.kind)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setValue(target.value)
    setKind(target.kind)
    setConfirming(false)
  }, [target.id, target.value, target.kind])

  const grouped = useMemo(() => groupByKind(target.facts), [target.facts])

  const dirty = value.trim() !== target.value || kind !== target.kind

  const submitRename = (): void => {
    if (onRename === undefined || value.trim() === '') return
    const patch: { kind?: string; value?: string } = {}
    if (value.trim() !== target.value) patch.value = value.trim()
    if (kind !== target.kind) patch.kind = kind
    if (patch.value === undefined && patch.kind === undefined) return
    onRename(patch)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{target.kind}</Badge>
          <span className="truncate font-mono text-[13px]">{target.value}</span>
          <ScopeBadge status={target.scopeStatus} reason={target.scopeReason} />
          {onClose !== undefined && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto -mr-1.5 shrink-0"
              onClick={onClose}
              aria-label="Close details"
            >
              <X className="size-4" strokeWidth={1.75} />
            </Button>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          first seen {formatDate(target.firstSeen)} · last seen {formatDate(target.lastSeen)}
        </div>
        {/* The verdict is spelled out only when it needs a decision; an in-scope
            asset would just be repeating what the absent badge already says. */}
        {target.scopeStatus !== 'in' && target.scopeReason !== '' && (
          <div className="mt-1 text-[11px] text-muted-foreground">{target.scopeReason}</div>
        )}
      </div>

      {/* Edit / delete affordances */}
      {(onRename !== undefined || onDelete !== undefined) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {onRename !== undefined && (
            <>
              <Select
                ariaLabel="Target kind"
                value={kind}
                onValueChange={(v) => setKind(v)}
                className="w-auto min-w-28"
                options={[
                  ...KINDS.map((k): SelectOption => ({ value: k, label: k })),
                  ...(KINDS.includes(target.kind as (typeof KINDS)[number])
                    ? []
                    : [{ value: target.kind, label: target.kind }]),
                ]}
              />
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                className="h-8 max-w-sm flex-1 font-mono text-[13px]"
                aria-label="Target value"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={renaming === true || !dirty || value.trim() === ''}
                onClick={submitRename}
              >
                {renaming === true ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}

          {onDelete !== undefined && (
            <div className="ml-auto flex items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-[12.5px] text-muted-foreground">
                    Delete target and all subdomains?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting === true}
                    onClick={() => onDelete()}
                  >
                    {deleting === true ? 'Deleting…' : 'Confirm'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                  <Trash2 className="size-4" strokeWidth={1.75} />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {error !== null && error !== undefined && error !== '' && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Findings first: what was proved about this asset outranks what was observed. */}
      <ScrollArea className="min-h-0 flex-1">
        {/* Sections are keyed by target, so picking another target replays the entrance. */}
        <div key={`${target.id}-findings`} className="motion-safe:animate-enter" style={stagger(0, 100)}>
          <Section title="Findings" count={target.findings.length} defaultOpen={target.findings.length > 0}>
            <TargetFindings findings={target.findings} />
          </Section>
        </div>

        {FACT_KIND_ORDER.map((k, i) => {
          const facts = grouped.get(k) ?? []
          const Renderer = FACT_RENDERERS[k]
          if (Renderer === undefined) return null
          return (
            <div key={`${target.id}-${k}`} className="motion-safe:animate-enter" style={stagger(i + 1, 100)}>
              <Section
                title={FACT_KIND_LABELS[k] ?? k}
                count={facts.length}
                defaultOpen={k === 'raw_output' ? false : facts.length > 0}
              >
                <Renderer facts={facts} />
              </Section>
            </div>
          )
        })}

        <div
          key={`${target.id}-screenshots`}
          className="motion-safe:animate-enter"
          style={stagger(FACT_KIND_ORDER.length + 1, 100)}
        >
          <Section title="Screenshots" count={screenshots.length}>
            <ScreenshotGallery items={screenshots} />
          </Section>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Container: fetches + wires mutations
// ---------------------------------------------------------------------------

export interface TargetDetailPanelProps {
  api: ReturnType<typeof targetsApi>
  targetId: string
  onChanged?: () => void
  onDeleted?: () => void
  onClose?: () => void
}

export function TargetDetailPanel({
  api,
  targetId,
  onChanged,
  onDeleted,
  onClose,
}: TargetDetailPanelProps): JSX.Element {
  const [target, setTarget] = useState<TargetDetail | null>(null)
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const detail = await api.get(targetId)
    setTarget(detail)
    try {
      setScreenshots(await api.screenshots(targetId))
    } catch {
      setScreenshots([])
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setScreenshots([])
    void (async () => {
      try {
        const detail = await api.get(targetId)
        if (cancelled) return
        setTarget(detail)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
      try {
        const shots = await api.screenshots(targetId)
        if (!cancelled) setScreenshots(shots)
      } catch {
        if (!cancelled) setScreenshots([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, targetId])

  // A live refresh swaps the findings in place: no loading state, and the
  // rename input and open sections are untouched because only `target` changes.
  const current = useRef({ api, targetId })
  useEffect(() => {
    current.current = { api, targetId }
  })
  useEngineChange(['findings'], () => {
    const asked = { api, targetId }
    void api
      .get(targetId)
      .then((detail) => {
        if (current.current.api === asked.api && current.current.targetId === asked.targetId) setTarget(detail)
      })
      .catch(() => {})
  })

  const handleRename = (patch: { kind?: string; value?: string }): void => {
    setRenaming(true)
    setError(null)
    void (async () => {
      try {
        await api.update(targetId, patch)
        await refresh()
        onChanged?.()
      } catch (e) {
        setError(apiErrorMessage(e, 'Could not rename that target.'))
      } finally {
        setRenaming(false)
      }
    })()
  }

  const handleDelete = (): void => {
    setDeleting(true)
    setError(null)
    void (async () => {
      try {
        await api.remove(targetId)
        onDeleted?.()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setDeleting(false)
      }
    })()
  }

  // A pane that cannot yet render its header still needs a way out, otherwise a
  // slow or failed fetch leaves the panel stuck open.
  const closeButton =
    onClose === undefined ? null : (
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        onClick={onClose}
        aria-label="Close details"
      >
        <X className="size-4" strokeWidth={1.75} />
      </Button>
    )

  if (loading && target === null) {
    return (
      <div className={cn('relative flex h-full items-center justify-center')}>
        {closeButton}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (target === null) {
    return (
      <div className="relative flex h-full items-center justify-center">
        {closeButton}
        <p className="text-sm text-destructive">{error ?? 'Failed to load target.'}</p>
      </div>
    )
  }

  return (
    <TargetDetailView
      target={target}
      screenshots={screenshots}
      onRename={handleRename}
      onDelete={handleDelete}
      onClose={onClose}
      renaming={renaming}
      deleting={deleting}
      error={error}
    />
  )
}
