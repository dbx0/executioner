import { useEffect, useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import {
  backendsApi,
  type BackendKind,
  type BackendProfile,
  type BackendProfileInput,
  type BackendTestResult,
  type SshEnrollResult,
} from '../../../api/backends.js'
import { empty, isValid, parseEnv, toForm, toInput, type FormState } from './form-state.js'
import { useConnectionHints, usePrefill } from './use-connection-hints.js'

export interface BackendForm {
  form: FormState
  set: (patch: Partial<FormState>) => void
  nameRef: React.RefObject<HTMLInputElement | null>
  error: string | null
  busy: boolean
  testing: boolean
  busyAny: boolean
  result: BackendTestResult | SshEnrollResult | null
  tested: boolean
  isPasswordAuth: boolean
  valid: boolean
  missingWorkdir: string | undefined
  runTest: (createWorkdir?: boolean) => Promise<void>
  saveNow: () => Promise<void>
}

/**
 * All of the add/edit-backend form state and the two-phase test-then-save flow.
 * Every hook lives here in the same order the modal used to call them.
 */
export function useBackendForm({
  client,
  initial,
  initialKind,
  onClose,
  onSaved,
}: {
  client: AxiosInstance
  initial?: BackendProfile | undefined
  initialKind?: BackendKind | undefined
  onClose: () => void
  onSaved: () => void
}): BackendForm {
  const api = backendsApi(client)
  const [form, setForm] = useState<FormState>(
    initial === undefined ? { ...empty, kind: initialKind ?? empty.kind } : toForm(initial),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<BackendTestResult | SshEnrollResult | null>(null)
  // A passed test unlocks Save; editing any field requires re-testing.
  const [tested, setTested] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const isPasswordAuth = form.kind === 'ssh' && form.authMethod === 'password'

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (patch: Partial<FormState>): void => {
    setForm((f) => ({ ...f, ...patch }))
    setResult(null)
    setError(null)
    setTested(false)
  }

  // Only a NEW profile gets prefilled; editing must not rewrite saved values.
  usePrefill(form, set, useConnectionHints(), initial === undefined)

  const valid = isValid(form)

  const persist = async (input: BackendProfileInput): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (form.id === undefined) await api.create(input)
      else await api.update(form.id, input)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Password auth: generate a keypair, install its public key on the host with
   * the one-time password, verify key-auth works, then save a normal SSH profile
   * pointing at the generated identity file. The password is discarded — never
   * sent to the profile create/update. A successful enroll IS the gate: there is
   * no "save anyway" here because you cannot save without a working key.
   */
  const enrollAndSave = async (): Promise<void> => {
    if (!valid || busy || testing) return
    setError(null)
    setResult(null)
    setTesting(true)
    let res: SshEnrollResult
    try {
      res = await api.sshEnroll({
        host: form.host.trim(),
        user: form.user.trim(),
        password: form.password,
        ...(form.port.trim() !== '' && Number.isFinite(Number(form.port)) ? { port: Number(form.port) } : {}),
      })
    } catch (e) {
      setTesting(false)
      setError((e as Error).message)
      return
    }
    setTesting(false)
    setResult(res)
    if (!res.ok || res.identityFile === null) return // keep the modal open to fix it
    // Build a normal SSH profile pointing at the generated key. The password is
    // never included in this payload.
    const input: BackendProfileInput = { name: form.name.trim(), kind: 'ssh', identityFile: res.identityFile }
    if (form.host.trim() !== '') input.host = form.host.trim()
    if (form.user.trim() !== '') input.user = form.user.trim()
    if (form.port.trim() !== '' && Number.isFinite(Number(form.port))) input.port = Number(form.port)
    if (form.workdir.trim() !== '') input.workdir = form.workdir.trim()
    const env = parseEnv(form.env)
    if (Object.keys(env).length > 0) input.env = env
    await persist(input)
  }

  /** Phase 1: run the liveness test WITHOUT saving. On success, unlock Save.
   *  `createWorkdir` mkdir -p a missing ssh workdir before verifying it. */
  const runTest = async (createWorkdir = false): Promise<void> => {
    if (!valid || busy || testing) return
    const input = toInput(form)
    setError(null)
    setResult(null)
    setTesting(true)
    let res: BackendTestResult
    try {
      res = await api.test(input, createWorkdir ? { createWorkdir: true } : undefined)
    } catch (e) {
      setTesting(false)
      setError((e as Error).message)
      return
    }
    setTesting(false)
    setResult(res)
    setTested(res.ok)
  }

  /** Phase 2 (or local / "Save anyway"): persist the profile as-is. */
  const saveNow = async (): Promise<void> => {
    if (!valid || busy || testing) return
    if (isPasswordAuth) {
      await enrollAndSave()
      return
    }
    await persist(toInput(form))
  }

  const busyAny = busy || testing
  const missingWorkdir = result !== null && 'missingWorkdir' in result ? result.missingWorkdir : undefined

  return {
    form,
    set,
    nameRef,
    error,
    busy,
    testing,
    busyAny,
    result,
    tested,
    isPasswordAuth,
    valid,
    missingWorkdir,
    runTest,
    saveNow,
  }
}
