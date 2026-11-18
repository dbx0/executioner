import type { JSX } from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import { backendsApi } from '../../api/backends.js'
import { errorFields, refreshLogMasks, rlog } from '../../lib/log.js'
import { toInput, type FormState } from '../modals/backends/form-state.js'
import { Button } from '../ui/button.js'
import { Spinner } from '../ui/spinner.js'
import { EngagementChoices, FooterStatus, StepBody, WizardFooter } from './parts.js'

/**
 * The last page of an SSH/Docker onboarding run. The connection was already
 * proven on the previous step, but saving one goes through an engagement's
 * engine, so this step opens an engagement and writes the verified profile
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
      // The connection's env values must be masked in main's log lines too.
      refreshLogMasks()
      onDone()
    } catch (e) {
      rlog.warn('onboarding', 'Could not save the connection', errorFields(e))
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
      <StepBody>
        {client === null ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] text-muted-foreground">
              <span className="font-medium text-foreground">{form.name}</span> is verified. Saving runs through an
              engagement: open or create one, and the connection is then there in all of them.
            </p>
            <EngagementChoices busy={opening} onOpen={onOpen} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px]">
            {busy ? (
              <span role="status" className="inline-flex items-center gap-2 text-muted-foreground">
                <Spinner />
                <span>
                  Saving <span className="font-medium text-foreground">{form.name}</span>…
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Couldn&apos;t save <span className="font-medium text-foreground">{form.name}</span>.
              </span>
            )}
          </div>
        )}

        {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </StepBody>

      <WizardFooter dots={dots} onSkip={onSkip}>
        <Button variant="ghost" size="sm" disabled={opening || busy} onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Back
        </Button>
        {client !== null && (
          <Button size="sm" disabled={busy} onClick={retry}>
            {busy && <Spinner />}
            Retry save
          </Button>
        )}
        {client === null && opening && <FooterStatus>Opening…</FooterStatus>}
      </WizardFooter>
    </>
  )
}
