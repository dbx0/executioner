import type { JSX } from 'react'
import { Container, Laptop, Loader2, Server } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import type { BackendKind, BackendProfile } from '../../api/backends.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Select } from '../ui/select.js'
import { DockerFields } from './backends/DockerFields.js'
import { EnvField } from './backends/EnvField.js'
import { SshFields } from './backends/SshFields.js'
import { TestProgress } from './backends/TestProgress.js'
import { expectedSteps } from './backends/form-state.js'
import { useBackendForm } from './backends/use-backend-form.js'

export { parseEnv, expectedSteps, type SshAuthMethod } from './backends/form-state.js'
export { TestProgress } from './backends/TestProgress.js'

const KIND_OPTIONS = [
  { value: 'local', label: 'Local machine', icon: <Laptop className="size-4" /> },
  { value: 'ssh', label: 'SSH host', icon: <Server className="size-4" /> },
  { value: 'docker', label: 'Docker image', icon: <Container className="size-4" /> },
]

/**
 * Add or edit one backend profile in a centered modal. For ssh/docker the Save
 * button first runs a liveness test (POST /backends/test) and only persists when
 * it passes; a muted "Save anyway" skips the test for a host that is not up yet.
 * Local profiles save immediately.
 */
export function AddBackendModal({
  client,
  initial,
  initialKind,
  onClose,
  onSaved,
}: {
  client: AxiosInstance
  initial?: BackendProfile
  /** For a new backend, the kind to open on (e.g. seeded from onboarding). */
  initialKind?: BackendKind
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const {
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
  } = useBackendForm({ client, initial, initialKind, onClose, onSaved })

  // Local needs no test; password enrollment IS the save; otherwise Save unlocks
  // only after a passing test — the button label follows that state.
  const primaryLabel = isPasswordAuth
    ? testing
      ? 'Enrolling…'
      : 'Enroll & save'
    : form.kind === 'local'
      ? 'Save'
      : testing
        ? 'Testing…'
        : busy
          ? 'Saving…'
          : tested
            ? 'Save'
            : 'Test'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[480px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[14px] font-medium">
          {form.id === undefined ? 'Add backend' : 'Edit backend'}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Name</label>
          <Input
            ref={nameRef}
            className="mb-3 h-8"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="scanbox"
          />

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Kind</label>
          <div className="mb-3">
            <Select
              value={form.kind}
              onValueChange={(v) => set({ kind: v as BackendKind })}
              options={KIND_OPTIONS}
              ariaLabel="Backend kind"
            />
          </div>

          {form.kind === 'ssh' && <SshFields form={form} set={set} />}

          {form.kind === 'docker' && <DockerFields form={form} set={set} />}

          {form.kind === 'local' ? (
            <p className="text-[12px] text-muted-foreground">Commands run on this machine. No connection to test.</p>
          ) : (
            <EnvField value={form.env} onChange={(v) => set({ env: v })} />
          )}

          <TestProgress testing={testing} pending={expectedSteps(form.kind, form.authMethod)} result={result} />

          {missingWorkdir !== undefined && missingWorkdir !== '' && !testing && (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-surface-1 p-2.5">
              <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
                The remote directory <code className="font-mono text-foreground">{missingWorkdir}</code> doesn&apos;t
                exist on the host.
              </p>
              <Button size="sm" variant="outline" className="shrink-0" disabled={busyAny} onClick={() => void runTest(true)}>
                Create &amp; test
              </Button>
            </div>
          )}

          {tested && result?.ok === true && (
            <p className="mt-3 text-[12px] text-status-success">Connection verified — save to add this backend.</p>
          )}

          {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div>
            {form.kind !== 'local' && !isPasswordAuth && !tested && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={!valid || busyAny}
                onClick={() => void saveNow()}
                title="Skip the connection test and save anyway"
              >
                Save without testing
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!valid || busyAny}
              onClick={() => (isPasswordAuth || form.kind === 'local' || tested ? void saveNow() : void runTest())}
            >
              {busyAny && <Loader2 className="size-4 animate-spin" />}
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
