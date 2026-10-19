import type { JSX } from 'react'
import { Input } from '../../ui/input.js'
import { cn } from '../../../lib/utils.js'
import { Field } from './Field.js'
import type { FormState, SshAuthMethod } from './form-state.js'
import { hostPatch, splitTarget, useConnectionHints } from './use-connection-hints.js'

/** Basename of a key path — the part worth reading in a narrow chip. */
function keyName(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * The SSH half of the backend form: auth method toggle, host/port and user/secret,
 * plus the workdir. Anything this machine already knows is offered as a chip —
 * ~/.ssh/config entries fill the whole block in one click, discovered keys fill the
 * identity file — and pasting `user@host:port` into Host splits itself apart.
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
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            From your ~/.ssh/config
          </label>
          <div className="flex flex-wrap gap-1.5">
            {hints.sshHosts.map((h) => (
              <button
                key={h.alias}
                type="button"
                onClick={() => set(hostPatch(h))}
                title={`${h.user === undefined ? '' : `${h.user}@`}${h.hostname}${h.port === undefined ? '' : `:${String(h.port)}`}`}
                className="rounded-md border border-border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {h.alias}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Auth method</label>
        <div className="inline-flex rounded-md border border-border p-0.5" role="tablist" aria-label="SSH auth method">
          {(
            [
              { value: 'identity', label: 'Identity file' },
              { value: 'password', label: 'Password (generate key)' },
            ] as { value: SshAuthMethod; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={form.authMethod === opt.value}
              onClick={() => set({ authMethod: opt.value })}
              className={cn(
                'rounded px-2.5 py-1 text-[12px] transition-colors',
                form.authMethod === opt.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* host : port — paired the way you'd write them. */}
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
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Password</label>
            <Input
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
            <button
              key={k}
              type="button"
              onClick={() => set({ identityFile: k })}
              title={k}
              className="rounded-md border border-border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {keyName(k)}
            </button>
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
          not stored — only the generated key is saved.
        </p>
      )}
    </div>
  )
}
