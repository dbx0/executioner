import type { JSX } from 'react'
import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import type { BackendTestResult, SshEnrollResult } from '../../api/backends.js'
import { DockerFields } from '../modals/backends/DockerFields.js'
import { EnvField } from '../modals/backends/EnvField.js'
import { SshFields } from '../modals/backends/SshFields.js'
import { Field } from '../modals/backends/Field.js'
import { TestProgress } from '../modals/backends/TestProgress.js'
import { expectedSteps, isValid, toInput, type FormState } from '../modals/backends/form-state.js'
import { useConnectionHints, usePrefill } from '../modals/backends/use-connection-hints.js'
import { Button } from '../ui/button.js'

/**
 * The connection page of an SSH/Docker onboarding run: collect the details, then
 * prove them. Verify is the only way forward — and it runs through the main
 * process, which starts the engine one-shot, so no engagement has to exist yet.
 * Only a pass turns the primary button into Next. Editing any field invalidates
 * the pass and asks again.
 */
export function OnboardingConnectionStep({
  form,
  set,
  dots,
  onBack,
  onNext,
  onSkip,
}: {
  form: FormState
  set: (patch: Partial<FormState>) => void
  dots: ReactNode
  onBack: () => void
  /** Hand the verified form on: the next step saves it into an engagement.
   *  `identityFile` is the key a password enrollment just generated, if any. */
  onNext: (identityFile: string | null) => void
  onSkip: () => void
}): JSX.Element {
  const [testing, setTesting] = useState(false)
  const [verified, setVerified] = useState(false)
  const [result, setResult] = useState<BackendTestResult | SshEnrollResult | null>(null)
  // Set by a successful password enrollment: the key the saved profile points at.
  const [enrolledKey, setEnrolledKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Port 22, this machine's username, a key off ~/.ssh and a runnable image get
  // filled in the moment they are known, so there is far less left to type.
  usePrefill(form, set, useConnectionHints(), true)

  const isPasswordAuth = form.kind === 'ssh' && form.authMethod === 'password'
  const valid = isValid(form)
  const busyAny = testing
  const missingWorkdir = result !== null && 'missingWorkdir' in result ? result.missingWorkdir : undefined

  /** Any edit invalidates the proof, so the step asks to verify again. */
  const edit = (patch: Partial<FormState>): void => {
    set(patch)
    setVerified(false)
    setResult(null)
    setEnrolledKey(null)
    setError(null)
  }

  /** Password auth: generate a keypair and install it with the one-time password.
   *  A pass leaves us holding the generated key; the password is never persisted. */
  const enroll = async (): Promise<void> => {
    let res: SshEnrollResult
    try {
      res = await window.executioner.enrollSsh({
        host: form.host.trim(),
        user: form.user.trim(),
        password: form.password,
        ...(form.port.trim() !== '' && Number.isFinite(Number(form.port)) ? { port: Number(form.port) } : {}),
      })
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setResult(res)
    if (!res.ok || res.identityFile === null) return
    setEnrolledKey(res.identityFile)
    setVerified(true)
  }

  /** Identity-file auth and Docker: a liveness test, optionally creating a
   *  missing remote workdir first. */
  const test = async (createWorkdir: boolean): Promise<void> => {
    let res: BackendTestResult
    try {
      res = await window.executioner.testBackend({
        profile: toInput(form),
        ...(createWorkdir ? { createWorkdir: true } : {}),
      })
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setResult(res)
    setVerified(res.ok)
  }

  const verify = async (createWorkdir = false): Promise<void> => {
    if (!valid || busyAny) return
    setError(null)
    setResult(null)
    setTesting(true)
    if (isPasswordAuth) await enroll()
    else await test(createWorkdir)
    setTesting(false)
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-5">
        <div className="flex flex-col gap-3">
          <Field label="Name" value={form.name} onChange={(v) => edit({ name: v })} placeholder={`${form.kind}-backend`} />
          {form.kind === 'ssh' ? <SshFields form={form} set={edit} /> : <DockerFields form={form} set={edit} />}
          <EnvField value={form.env} onChange={(v) => edit({ env: v })} />
        </div>

        <TestProgress testing={testing} pending={expectedSteps(form.kind, form.authMethod)} result={result} />

        {enrolledKey !== null && enrolledKey !== '' && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Generated key saved to <code className="font-mono text-foreground">{enrolledKey}</code>. The password was
            not stored.
          </p>
        )}

        {missingWorkdir !== undefined && missingWorkdir !== '' && !busyAny && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-surface-1 p-2.5">
            <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              The remote directory <code className="font-mono text-foreground">{missingWorkdir}</code> doesn&apos;t
              exist on the host.
            </p>
            <Button size="sm" variant="outline" className="shrink-0" disabled={busyAny} onClick={() => void verify(true)}>
              Create &amp; verify
            </Button>
          </div>
        )}

        {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onSkip} className="text-[12px] text-muted-foreground hover:text-foreground">
          Skip setup
        </button>
        <div className="mx-auto flex items-center gap-1.5">{dots}</div>
        <Button variant="ghost" size="sm" disabled={busyAny} onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Back
        </Button>
        {verified ? (
          <Button size="sm" onClick={() => onNext(enrolledKey)}>
            Next
            <ArrowRight className="size-4" strokeWidth={1.75} />
          </Button>
        ) : (
          <Button size="sm" disabled={!valid || busyAny} onClick={() => void verify()}>
            {testing && <Loader2 className="size-4 animate-spin" />}
            {testing ? (isPasswordAuth ? 'Enrolling…' : 'Verifying…') : 'Verify'}
          </Button>
        )}
      </div>
    </>
  )
}
