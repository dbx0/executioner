import type { JSX } from 'react'
import { Input } from '../../ui/input.js'
import { FieldLabel } from '../field-label.js'
import { ModeTabs, type ModeTab } from '../mode-tabs.js'
import { Field } from './Field.js'
import { HintChip } from './HintChip.js'
import type { FormState, SshAuthMethod } from './form-state.js'
import { hostPatch, splitTarget, useConnectionHints } from './use-connection-hints.js'

const AUTH_METHODS: ModeTab<SshAuthMethod>[] = [
  { id: 'identity', label: 'Identity file' },
  { id: 'password', label: 'Password (generate key)' },
]

/** Basename of a key path, the part worth reading in a narrow chip. */
function keyName(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * The SSH half of the backend form: auth method toggle, host/port and user/secret,
 * plus the workdir. Anything this machine already knows is offered as a chip:
 * ~/.ssh/config entries fill the whole block in one click and discovered keys fill
 * the identity file. Pasting `user@host:port` into Host splits itself apart.
 */
export function SshFields({
  form,
  set,
}: {
  form: FormState
  set: (patch: Partial<FormState>) => void
}): JSX.Element {
  const hints = useConnectionHints()
  const otherKeys = hints.sshKeys.filter((k) => k !== form.identityFile)

  return (
    <div className="flex flex-col gap-2">
      {hints.sshHosts.length > 0 && (
        <div>
          <FieldLabel>From your ~/.ssh/config</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {hints.sshHosts.map((h) => (
              <HintChip
                key={h.alias}
                hint={`${h.user === undefined ? '' : `${h.user}@`}${h.hostname}${h.port === undefined ? '' : `:${String(h.port)}`}`}
                onClick={() => set(hostPatch(h))}
              >
                {h.alias}
              </HintChip>
            ))}
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Auth method</FieldLabel>
        <ModeTabs
          tabs={AUTH_METHODS}
          value={form.authMethod}
          onSelect={(authMethod) => set({ authMethod })}
          label="SSH auth method"
        />
      </div>

      {/* host : port, paired the way you'd write them. */}
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <Field
          label="Host"
          value={form.host}
          onChange={(v) => set(splitTarget(v))}
          placeholder="10.0.0.5 or user@host:22"
        />
        <Field label="Port" value={form.port} onChange={(v) => set({ port: v })} placeholder="22" />
      </div>

      {/* user : secret */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="User" value={form.user} onChange={(v) => set({ user: v })} placeholder="root" />
        {form.authMethod === 'identity' ? (
          <Field
            label="Identity file"
            value={form.identityFile}
            onChange={(v) => set({ identityFile: v })}
            placeholder="~/.ssh/id_ed25519"
          />
        ) : (
          <div>
            <FieldLabel htmlFor="backend-ssh-password">Password</FieldLabel>
            <Input
              id="backend-ssh-password"
              className="h-8"
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder="••••••••"
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {form.authMethod === 'identity' && otherKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Keys found:</span>
          {otherKeys.map((k) => (
            <HintChip key={k} hint={k} onClick={() => set({ identityFile: k })}>
              {keyName(k)}
            </HintChip>
          ))}
        </div>
      )}

      <Field
        label="Remote workdir (optional)"
        value={form.workdir}
        onChange={(v) => set({ workdir: v })}
        placeholder="/root/engagement"
      />

      {form.authMethod === 'password' && (
        <p className="text-[11px] text-muted-foreground">
          Generates an SSH keypair and installs its public key on the host using this password once. The password is
          not stored. Only the generated key is saved.
        </p>
      )}
    </div>
  )
}
