import type { JSX } from 'react'
import { Container, Laptop, Server } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import type { BackendKind, BackendProfile } from '../../api/backends.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/dialog.js'
import { Input } from '../ui/input.js'
import { Select } from '../ui/select.js'
import { Spinner } from '../ui/spinner.js'
import { Tip } from '../ui/tip.js'
import { DockerFields } from './backends/DockerFields.js'
import { EnvField } from './backends/EnvField.js'
import { FieldLabel } from './field-label.js'
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
  // only after a passing test. The button label follows that state.
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
    <Dialog onClose={onClose} className="w-[480px]">
      <DialogHeader title={form.id === undefined ? 'Add backend' : 'Edit backend'} />

      <DialogBody>
        <FieldLabel htmlFor="backend-name">Name</FieldLabel>
        <Input
          id="backend-name"
          ref={nameRef}
          className="mb-3 h-8"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="scanbox"
        />

        <FieldLabel>Kind</FieldLabel>
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
          <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-glass-border bg-glass p-3">
            <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              The remote directory <code className="font-mono text-foreground">{missingWorkdir}</code> doesn&apos;t
              exist on the host.
            </p>
            <Button size="sm" variant="glass" className="shrink-0" disabled={busyAny} onClick={() => void runTest(true)}>
              Create &amp; test
            </Button>
          </div>
        )}

        {tested && result?.ok === true && (
          <p className="mt-3 text-[12px] text-status-success">Connection verified. Save to add this backend.</p>
        )}

        {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </DialogBody>

      <DialogFooter className="justify-between">
        <div>
          {form.kind !== 'local' && !isPasswordAuth && !tested && (
            <Tip label="Skip the connection test and save anyway" side="top">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={!valid || busyAny}
                onClick={() => void saveNow()}
              >
                Save without testing
              </Button>
            </Tip>
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
            {busyAny && <Spinner />}
            {primaryLabel}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
