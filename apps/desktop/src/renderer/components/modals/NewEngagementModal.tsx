import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../../store.js'
import { Button } from '../ui/button.js'
import { scopeApi } from '../../api/scope.js'
import { targetsApi } from '../../api/targets.js'
import { normalizeManualTarget, type NormalizedTarget } from '../../lib/target-input.js'
import { basename, type Phase, type TabId } from './new-engagement/constants.js'
import { AiTab, ManualTab, ModeTabs, OpenTab } from './new-engagement/tabs.js'
import { ConfirmationPage, RunningPage } from './new-engagement/result-pages.js'
import { ModalFooter } from './new-engagement/footer.js'

export function NewEngagementModal(): JSX.Element | null {
  const open = useApp((s) => s.newEngagementOpen)
  const initialTab = useApp((s) => s.newEngagementTab)
  const close = useApp((s) => s.closeNewEngagement)
  const pickFolder = useApp((s) => s.pickEngagementFolder)
  const createEngagement = useApp((s) => s.createEngagement)
  const openEngagementFolder = useApp((s) => s.openEngagementFolder)
  const beginScopeRun = useApp((s) => s.beginScopeRun)
  const recents = useApp((s) => s.recents)
  const openEngagements = useApp((s) => s.open)
  const defaultAgent = useApp((s) => s.defaultAgent)
  const busy = useApp((s) => s.busy)
  const storeError = useApp((s) => s.error)

  const [tab, setTab] = useState<TabId>('ai')
  const [phase, setPhase] = useState<Phase>('form')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | undefined>(undefined)
  // The photo is held as a PNG data URL until the engagement folder exists; the
  // store writes it into that folder as part of creating the engagement.
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [dir, setDir] = useState<string | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState('')
  const [targets, setTargets] = useState<NormalizedTarget[]>([])
  const [targetInput, setTargetInput] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [manualSummary, setManualSummary] = useState<{ count: number } | null>(null)

  const scopeRun = useApp((s) => (runId !== null ? s.scopeRuns[runId] : undefined))
  const openRoots = useMemo(() => openEngagements.map((e) => e.root), [openEngagements])

  // Reset all local state each time the modal opens, on whichever tab the
  // caller asked for ("Open engagement" opens it on Open existing).
  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setPhase('form')
      setName('')
      setIcon(undefined)
      setPhoto(undefined)
      setDir(undefined)
      setDescription('')
      setScope('')
      setTargets([])
      setTargetInput('')
      setLocalError(null)
      setRunId(null)
      setManualSummary(null)
    }
  }, [open, initialTab])

  // When the streamed scope run finishes, advance to the confirmation page.
  useEffect(() => {
    if (phase === 'running' && scopeRun?.done === true) setPhase('done')
  }, [phase, scopeRun?.done])

  if (!open) return null

  const pickInto = (): void => {
    void pickFolder().then((chosen) => {
      if (chosen === undefined) return
      setDir(chosen)
      if (name.trim() === '') setName(basename(chosen))
    })
  }

  const addTarget = (): void => {
    const normalized = normalizeManualTarget(targetInput)
    if (normalized === null) {
      setLocalError(`"${targetInput.trim()}" is not a valid target`)
      return
    }
    setLocalError(null)
    setTargetInput('')
    setTargets((prev) =>
      prev.some((t) => t.kind === normalized.kind && t.value === normalized.value) ? prev : [...prev, normalized],
    )
  }

  const removeTarget = (t: NormalizedTarget): void => {
    setTargets((prev) => prev.filter((x) => !(x.kind === t.kind && x.value === t.value)))
  }

  const canCreate = name.trim() !== '' && dir !== undefined

  const submitAi = async (): Promise<void> => {
    if (!canCreate) {
      setLocalError('A name and a folder are required')
      return
    }
    setLocalError(null)
    const root = await createEngagement({
      dir: dir!,
      name: name.trim(),
      ...(icon !== undefined ? { icon } : {}),
      ...(photo !== undefined ? { photo } : {}),
      description,
      scope,
    })
    if (root === null) return // store.error is shown
    const client = useApp.getState().client
    if (client === null) {
      setPhase('done') // engagement is open; just skip the parse
      return
    }
    try {
      const { runId: id } = await scopeApi(client).parse({
        scope,
        ...(defaultAgent !== null ? { agent: defaultAgent } : {}),
        // The same run tidies the brief: the scaffold has already written it to
        // HUNT.md verbatim, so a failed or absent agent leaves it as typed.
        ...(description.trim() === '' ? {} : { description }),
      })
      beginScopeRun(id)
      setRunId(id)
      setPhase('running')
    } catch (e) {
      setLocalError((e as Error).message)
      setPhase('done')
    }
  }

  const submitManual = async (): Promise<void> => {
    if (!canCreate) {
      setLocalError('A name and a folder are required')
      return
    }
    setLocalError(null)
    const root = await createEngagement({
      dir: dir!,
      name: name.trim(),
      ...(icon !== undefined ? { icon } : {}),
      ...(photo !== undefined ? { photo } : {}),
      description,
    })
    if (root === null) return
    const client = useApp.getState().client
    let added = 0
    if (client !== null) {
      for (const t of targets) {
        try {
          await targetsApi(client).create({ kind: t.kind, value: t.value })
          added += 1
        } catch {
          /* skip a target that fails to add rather than aborting the rest */
        }
      }
    }
    setManualSummary({ count: added })
    setPhase('done')
  }

  const submitOpen = async (chosen: string | undefined = dir): Promise<void> => {
    if (chosen === undefined) {
      setLocalError('Choose an engagement folder to open')
      return
    }
    setLocalError(null)
    const root = await openEngagementFolder(chosen)
    if (root !== null) close()
  }

  const error = localError ?? storeError

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-[2px]" onClick={() => !busy && close()}>
      <div
        className="flex max-h-[88vh] w-[640px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="text-[15px] font-medium">New engagement</div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => close()} disabled={busy}>
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        {phase === 'form' && (
          <ModeTabs
            tab={tab}
            onSelect={(id) => {
              setTab(id)
              setLocalError(null)
            }}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-5">
          {phase === 'done' ? (
            <ConfirmationPage
              tab={tab}
              scopeRun={scopeRun}
              manualSummary={manualSummary}
              name={name.trim()}
              icon={icon}
              photo={photo}
            />
          ) : phase === 'running' ? (
            <RunningPage scopeRun={scopeRun} />
          ) : tab === 'ai' ? (
            <AiTab
              name={name}
              setName={setName}
              icon={icon}
              setIcon={setIcon}
              photo={photo}
              setPhoto={setPhoto}
              dir={dir}
              onPickFolder={pickInto}
              busy={busy}
              description={description}
              setDescription={setDescription}
              scope={scope}
              setScope={setScope}
            />
          ) : tab === 'manual' ? (
            <ManualTab
              name={name}
              setName={setName}
              icon={icon}
              setIcon={setIcon}
              photo={photo}
              setPhoto={setPhoto}
              dir={dir}
              onPickFolder={pickInto}
              busy={busy}
              description={description}
              setDescription={setDescription}
              targetInput={targetInput}
              setTargetInput={setTargetInput}
              onAddTarget={addTarget}
              targets={targets}
              onRemoveTarget={removeTarget}
            />
          ) : (
            <OpenTab
              dir={dir}
              onPickFolder={pickInto}
              busy={busy}
              recents={recents}
              openRoots={openRoots}
              onSelectRecent={(root) => {
                setLocalError(null)
                setDir(root)
              }}
              onOpenRecent={(root) => {
                setDir(root)
                void submitOpen(root)
              }}
            />
          )}

          {error !== null && phase === 'form' && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
        </div>

        <ModalFooter
          phase={phase}
          tab={tab}
          busy={busy}
          canCreate={canCreate}
          dir={dir}
          onClose={() => close()}
          onSubmitAi={() => void submitAi()}
          onSubmitManual={() => void submitManual()}
          onSubmitOpen={() => void submitOpen()}
        />
      </div>
    </div>
  )
}
