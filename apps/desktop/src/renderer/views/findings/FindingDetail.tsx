import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { Finding, FindingInput } from '../../api/findings.js'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { Step } from './field.js'
import { FindingActions } from './FindingActions.js'
import { FindingFullScreenField } from './FindingFullScreenField.js'
import { FindingHeader } from './FindingHeader.js'
import { FindingMetaGrid } from './FindingMetaGrid.js'
import { FindingProseField, type ProseView } from './FindingProse.js'
import { FindingTriage } from './FindingTriage.js'

/**
 * How tall a rendered field may grow before it scrolls. Expanded gets the list
 * column's width back and no competition for the page, so the ceilings lift.
 */
const CAPS = {
  split: { description: 'max-h-48', details: 'max-h-96' },
  expanded: { description: 'max-h-72', details: 'max-h-[60vh]' },
} as const

/** Rendered when there is prose to render, the editor when there is not. */
function initialView(finding: Finding): ProseView {
  return finding.description.trim() === '' && finding.details.trim() === '' ? 'edit' : 'preview'
}

/**
 * One finding, open for reading and editing. Edits are held locally and saved
 * on Save: a findings page where every keystroke hits the engine would fight
 * you while you write up an explanation.
 */
export function FindingDetail({
  finding,
  targetValue,
  saving,
  deleting = false,
  expanded,
  onToggleExpand,
  onSave,
  onDelete,
}: {
  finding: Finding
  targetValue: string | null
  saving: boolean
  /** True while this finding's delete is in flight. */
  deleting?: boolean
  /** True while the finding has the page to itself, the list column hidden. */
  expanded: boolean
  onToggleExpand: () => void
  onSave: (patch: Partial<FindingInput>) => void
  onDelete: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(finding)
  // A finding with prose opens rendered, since reading and triaging is the
  // common case, while an empty one opens in the editor: there is nothing to
  // render and the operator is here to write it.
  const [view, setView] = useState<ProseView>(() => initialView(finding))
  // Which prose field, if any, is currently taking over the app window.
  const [fullScreen, setFullScreen] = useState<'description' | 'details' | null>(null)
  // Selecting another finding replaces the draft; an unsaved edit is not carried
  // across, which is what you want when the two are different findings.
  useEffect(() => {
    setDraft(finding)
    setView(initialView(finding))
    setFullScreen(null)
  }, [finding])

  const dirty =
    draft.title !== finding.title ||
    draft.severity !== finding.severity ||
    draft.status !== finding.status ||
    draft.description !== finding.description ||
    draft.details !== finding.details

  const caps = expanded ? CAPS.expanded : CAPS.split

  const save = (): void => {
    onSave({
      title: draft.title,
      severity: draft.severity,
      status: draft.status,
      description: draft.description,
      details: draft.details,
    })
  }

  return (
    <>
      <GlassPanel className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
          {/* One centred reading column for the whole pane: on a wide window the title,
              its actions, the prose and the metadata all share the same two edges,
              instead of the prose stopping short while the header runs the full width. */}
          <div className="mx-auto flex w-full min-w-0 max-w-[1040px] flex-col gap-[18px] px-[26px] py-[22px]">
            <FindingHeader
              title={draft.title}
              onTitleChange={(title) => setDraft({ ...draft, title })}
              actions={
                <FindingActions
                  expanded={expanded}
                  view={view}
                  dirty={dirty}
                  saving={saving}
                  deleting={deleting}
                  onToggleExpand={onToggleExpand}
                  onToggleView={() => setView(view === 'preview' ? 'edit' : 'preview')}
                  onSave={save}
                  onDelete={onDelete}
                />
              }
            />

            <Step index={1}>
              <FindingTriage
                severity={draft.severity}
                status={draft.status}
                targetValue={targetValue}
                onSeverityChange={(severity) => setDraft({ ...draft, severity })}
                onStatusChange={(status) => setDraft({ ...draft, status })}
              />
            </Step>

          <Step index={2}>
              <FindingProseField
                label="Description"
                value={draft.description}
                view={view}
                cap={caps.description}
                rows={4}
                placeholder="What it is and why it matters. Markdown."
                onChange={(description) => setDraft({ ...draft, description })}
                onFullScreen={() => setFullScreen('description')}
              />
            </Step>

            <Step index={3}>
              <FindingProseField
                label="Details"
                value={draft.details}
                view={view}
                cap={caps.details}
                rows={16}
                placeholder="The evidence: request, payload, matched secret, notes. Markdown."
                onChange={(details) => setDraft({ ...draft, details })}
                onFullScreen={() => setFullScreen('details')}
              />
            </Step>

            <Step index={4}>
              <FindingMetaGrid finding={finding} />
            </Step>
          </div>
        </ScrollArea>
      </GlassPanel>

      {/* Outside the panel: a fixed overlay must not be clipped by the panel's own stacking context. */}
      {fullScreen !== null && (
        <FindingFullScreenField
          label={fullScreen === 'description' ? 'Description' : 'Details'}
          value={fullScreen === 'description' ? draft.description : draft.details}
          view={view}
          onChange={(value) => setDraft({ ...draft, [fullScreen]: value })}
          onClose={() => setFullScreen(null)}
        />
      )}
    </>
  )
}
