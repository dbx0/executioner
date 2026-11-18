import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { KeyRound, Check } from 'lucide-react'
import { secretsApi, type Secret } from '../api/secrets.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog.js'
import { Skeleton } from './ui/skeleton.js'
import { Spinner } from './ui/spinner.js'
import { refreshLogMasks } from '../lib/log.js'

interface Provider {
  name: string
  domain: string
  description: string
  keys: { key: string; label: string; placeholder: string; optional?: boolean }[]
}

/** The API-key providers the integration nodes support. */
const PROVIDERS: Provider[] = [
  {
    name: 'Shodan',
    domain: 'shodan.io',
    description: 'Host lookups. Get a key at account.shodan.io',
    keys: [{ key: 'SHODAN_API_KEY', label: 'API key', placeholder: '32-character key, e.g. aBcD…09Xy' }],
  },
  {
    name: 'Censys',
    domain: 'censys.io',
    description: 'Host view. Create a personal access token at platform.censys.io',
    keys: [
      { key: 'CENSYS_API_TOKEN', label: 'Personal access token', placeholder: 'censys_…' },
      {
        key: 'CENSYS_ORG_ID',
        label: 'Organization ID',
        placeholder: 'Optional. Paid plans only, leave empty on Free',
        optional: true,
      },
    ],
  },
]

/** A site favicon that falls back to a key icon if it can't load. */
function Favicon({ domain }: { domain: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-glass-strong">
        <KeyRound className="size-4 text-muted-foreground" strokeWidth={1.75} />
      </span>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={28}
      height={28}
      onError={() => setFailed(true)}
      className="size-7 shrink-0 rounded-[9px]"
    />
  )
}

/**
 * The Settings secrets area: the known providers listed one per row with their
 * favicon and a Set/Update button. Setting a key opens a small modal.
 */
export function SecretsSection({ client }: { client: AxiosInstance }): JSX.Element {
  const api = secretsApi(client)
  // Null until the first list settles: a provider is not offered as unset while that is unknown.
  const [secrets, setSecrets] = useState<Secret[] | null>(null)
  const [editing, setEditing] = useState<Provider | null>(null)

  const refresh = useCallback(() => {
    void api
      .list()
      .then(setSecrets)
      .catch(() => setSecrets([]))
  }, [api])

  useEffect(refresh, [refresh])

  const setKeys = new Set((secrets ?? []).map((s) => s.key))

  return (
    <>
      <div className="flex flex-col">
        {PROVIDERS.map((p) => {
          const configured = p.keys.every((k) => k.optional === true || setKeys.has(k.key))
          return (
            <div key={p.name} className="flex items-center gap-3 border-b border-glass-border py-3">
              <Favicon domain={p.domain} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {p.name}
                  {configured && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-status-success">
                      <Check className="size-3" strokeWidth={2.5} /> Configured
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.description}</div>
              </div>
              {secrets === null ? (
                <Skeleton role="status" aria-label={`Loading ${p.name} key status`} className="h-8 w-[84px] shrink-0 rounded-full" />
              ) : (
                <Button variant="glass" size="sm" className="shrink-0" onClick={() => setEditing(p)}>
                  {configured ? 'Update key' : 'Set key'}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {editing !== null && (
        <SetSecretModal
          provider={editing}
          api={api}
          setKeys={setKeys}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh()
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function SetSecretModal({
  provider,
  api,
  setKeys,
  onClose,
  onSaved,
}: {
  provider: Provider
  api: ReturnType<typeof secretsApi>
  setKeys: Set<string>
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      for (const { key } of provider.keys) {
        const v = values[key]?.trim()
        if (v !== undefined && v !== '') await api.set(key, v)
      }
      refreshLogMasks()
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onClose={onClose} size="sm" dismissable={!busy}>
      <DialogHeader icon={<Favicon domain={provider.domain} />} title={provider.name} />
      <DialogBody className="flex flex-col gap-3">
        {provider.keys.map((k) => (
          <label key={k.key} className="flex flex-col gap-1.5 text-[13px]">
            <span className="flex items-center gap-2">
              {k.label}
              {k.optional === true && <span className="text-[11px] text-muted-foreground">optional</span>}
              <span className="font-mono text-[11px] text-muted-foreground">{k.key}</span>
              {setKeys.has(k.key) && <span className="text-[11px] text-status-success">set</span>}
            </span>
            <Input
              type="password"
              className="h-8"
              placeholder={setKeys.has(k.key) ? 'Enter to replace…' : k.placeholder}
              value={values[k.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [k.key]: e.target.value }))}
            />
          </label>
        ))}
        {error !== null && <p className="text-[12px] text-status-error">{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || provider.keys.every((k) => (values[k.key] ?? '').trim() === '')}
          onClick={() => void save()}
        >
          {busy && <Spinner size="sm" />}
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
