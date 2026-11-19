import type { JSX } from 'react'
import { useMemo } from 'react'
import type { ScreenshotItem, TargetDetail, TargetFact, targetsApi } from '../../api/targets.js'
import { stagger } from '../../lib/motion.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Banner } from './Banner.js'
import { FACT_KIND_LABELS, FACT_KIND_ORDER, FACT_RENDERERS, Section } from './fact-sections.js'
import { ScreenshotGallery } from './ScreenshotGallery.js'
import { TargetDetailSkeleton } from './TargetDetailSkeleton.js'
import { CloseDetailButton, TargetDetailHeader } from './TargetDetailHeader.js'
import { TargetEditBar, type TargetRenamePatch } from './TargetEditBar.js'
import { TargetFindings } from './TargetFindings.js'
import { useTargetDetail } from './useTargetDetail.js'

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
  onRename?: (patch: TargetRenamePatch) => void
  onDelete?: () => void
  onClose?: (() => void) | undefined
  renaming?: boolean
  deleting?: boolean
  /** Screenshots are fetched after the detail and may still be on their way. */
  screenshotsLoading?: boolean
  error?: string | null
}

/**
 * The section cards, in reading order. Each is keyed by target, so picking
 * another target replays the staggered entrance. The delay is per card, which
 * only an inline style can carry.
 */
function TargetSections({
  target,
  screenshots,
  screenshotsLoading,
}: {
  target: TargetDetail
  screenshots: ScreenshotItem[]
  screenshotsLoading: boolean
}): JSX.Element {
  const grouped = useMemo(() => groupByKind(target.facts), [target.facts])
  return (
    <div className="flex flex-col gap-[18px] px-[22px] pb-5">
      {/* Findings first: what was proved about this asset outranks what was observed. */}
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
        <Section title="Screenshots" count={screenshots.length} loading={screenshotsLoading}>
          <ScreenshotGallery items={screenshots} />
        </Section>
      </div>
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
  screenshotsLoading,
  error,
}: TargetDetailViewProps): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3.5 px-[22px] pb-[18px] pt-5">
        <TargetDetailHeader target={target} onClose={onClose} />
        <TargetEditBar
          target={target}
          onRename={onRename}
          onDelete={onDelete}
          renaming={renaming}
          deleting={deleting}
        />
        {error !== null && error !== undefined && error !== '' && (
          <Banner tone="error">
            {error}
          </Banner>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <TargetSections target={target} screenshots={screenshots} screenshotsLoading={screenshotsLoading === true} />
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
  const state = useTargetDetail(api, targetId, { onChanged, onDeleted })
  // A target still on screen from the previous selection is not this one's
  // detail: until the new one lands, the pane shows its loading state instead.
  const target = state.target !== null && state.target.id === targetId ? state.target : null

  if (target === null) {
    // A pane that cannot yet render its header still needs a way out, otherwise
    // a slow or failed fetch leaves the panel stuck open.
    return (
      <div className="relative h-full">
        {onClose !== undefined && <CloseDetailButton onClose={onClose} className="absolute right-[22px] top-5 z-10" />}
        {state.loading ? (
          <TargetDetailSkeleton />
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <p role="alert" className="text-sm text-destructive">
              {state.error ?? 'Failed to load target.'}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <TargetDetailView
      target={target}
      screenshots={state.screenshots}
      onRename={state.rename}
      onDelete={state.remove}
      onClose={onClose}
      renaming={state.renaming}
      deleting={state.deleting}
      screenshotsLoading={state.screenshotsLoading}
      error={state.error}
    />
  )
}
