import type { JSX } from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, FolderOpen, FolderPlus, Loader2 } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import { backendsApi } from '../../api/backends.js'
import { toInput, type FormState } from '../modals/backends/form-state.js'
import { Button } from '../ui/button.js'

/**
 * The last page of an SSH/Docker onboarding run. The connection was already
 * proven on the previous step, but saving one goes through an engagement's
 * engine — so this step opens an engagement and writes the verified profile
 * through it. The profile itself is user-level and is there in every engagement
 * afterwards. The save runs as soon as the engine is up and, on success,
 * finishes onboarding itself: there is nothing left to decide, and the user
 * asked for an engagement, not for another dialog on top of it. Only a failure
 * keeps the wizard up.
 */
export function OnboardingWorkspaceStep({
  client,
  form,
  identityFile,
  dots,
  opening,
  onOpen,
  onBack,
  onSkip,
  onDone,
}: {
  client: AxiosInstance | null
  form: FormState
  /** The key a password enrollment generated, if that is how it was verified. */
  identityFile: string | null
  dots: ReactNode
  opening: boolean
  onOpen: (create: boolean) => void
  onBack: () => void
  onSkip: () => void
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The engine only appears once an engagement opens; save exactly once when it
  // does (a ref, so React's double-invoked effects can't write the profile twice).
  const attempted = useRef(false)

  const save = async (api: ReturnType<typeof backendsApi>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const input = toInput(form)
      if (identityFile !== null && identityFile !== '') input.identityFile = identityFile
      await api.create(input)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (client === null || attempted.current) return
    attempted.current = true
    void save(backendsApi(client))
    // Only the arrival of a client should trigger the one automatic save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const retry = (): void => {
    if (client === null || busy) return
    void save(backendsApi(client))
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-5">
        {client === null ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] text-muted-foreground">
              <span className="font-medium text-foreground">{form.name}</span> is verified. Saving runs through an
              engagement — open or create one, and the connection is then there in all of them.
            </p>
            <button
              type="button"
              disabled={opening}
              onClick={() => onOpen(false)}
              className="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-surface-1 disabled:opacity-50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
                <FolderOpen className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Open engagement</div>
                <div className="text-[11.5px] text-muted-foreground">Pick an existing engagement folder.</div>
              </div>
            </button>
            <button
              type="button"
              disabled={opening}
              onClick={() => onOpen(true)}
              className="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-surface-1 disabled:opacity-50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
                <FolderPlus className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">New engagement</div>
                <div className="text-[11.5px] text-muted-foreground">Create a fresh engagement in a new folder.</div>
              </div>
              {opening && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px]">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">
                  Saving <span className="font-medium text-foreground">{form.name}</span>…
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Couldn&apos;t save <span className="font-medium text-foreground">{form.name}</span>.
              </span>
            )}
          </div>
        )}

        {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onSkip} className="text-[12px] text-muted-foreground hover:text-foreground">
          Skip setup
        </button>
        <div className="mx-auto flex items-center gap-1.5">{dots}</div>
        <Button variant="ghost" size="sm" disabled={opening || busy} onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Back
        </Button>
        {client !== null && (
          <Button size="sm" disabled={busy} onClick={retry}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Retry save
          </Button>
        )}
        {client === null && opening && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Opening…
          </span>
        )}
      </div>
    </>
  )
}
