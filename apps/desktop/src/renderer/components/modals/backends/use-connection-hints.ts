import { useEffect, useRef, useState } from 'react'
import type { ConnectionHints, SshHostHint } from '../../../../main/connection-hints.js'
import type { FormState } from './form-state.js'

/** Images worth suggesting when nothing local fits — the usual offensive bases. */
export const RECOMMENDED_IMAGES: { image: string; blurb: string }[] = [
  { image: 'kalilinux/kali-rolling', blurb: 'Kali rolling — the usual toolbox' },
  { image: 'parrotsec/security', blurb: 'Parrot Security' },
  { image: 'ubuntu:24.04', blurb: 'Plain Ubuntu to build on' },
]

const EMPTY: ConnectionHints = { sshHosts: [], sshKeys: [], defaultUser: '', dockerImages: [] }

/**
 * What this machine can tell us about how to connect: ~/.ssh hosts and keys, the
 * local username, and any docker images already pulled. Loaded once per mount and
 * degraded to empty on any failure — hints must never block the form.
 */
export function useConnectionHints(): ConnectionHints {
  const [hints, setHints] = useState<ConnectionHints>(EMPTY)

  useEffect(() => {
    let alive = true
    const probe = window.executioner?.connectionHints?.()
    if (probe === undefined) return
    void probe.then((h) => alive && setHints(h)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  return hints
}

/**
 * Fill the blanks once, the moment hints arrive: port 22, this machine's username,
 * and the most conventional key on disk. Only ever writes fields the user has left
 * empty, and only for a NEW profile — editing an existing one must not be rewritten
 * under the user's hands.
 */
export function usePrefill(
  form: FormState,
  set: (patch: Partial<FormState>) => void,
  hints: ConnectionHints,
  enabled: boolean,
): void {
  const done = useRef(false)
  // Read the live form through a ref so filling doesn't depend on form identity,
  // which would re-run this on every keystroke.
  const latest = useRef(form)
  latest.current = form
  const setRef = useRef(set)
  setRef.current = set

  useEffect(() => {
    if (!enabled || done.current) return
    // Wait for the one async source; the rest arrive with it.
    if (hints.defaultUser === '') return
    done.current = true
    const f = latest.current
    const patch: Partial<FormState> = {}
    if (f.port.trim() === '') patch.port = '22'
    if (f.user.trim() === '') patch.user = hints.defaultUser
    const key = hints.sshKeys[0]
    if (f.identityFile.trim() === '' && key !== undefined) patch.identityFile = key
    // Prefer a recommended image already on disk (nothing to pull), else the
    // first recommendation — either way the Docker field starts usable.
    if (f.image.trim() === '') {
      const pulled = RECOMMENDED_IMAGES.find((r) => hints.dockerImages.includes(r.image))
      patch.image = pulled?.image ?? RECOMMENDED_IMAGES[0]?.image ?? ''
    }
    if (Object.keys(patch).length > 0) setRef.current(patch)
  }, [enabled, hints])
}

/** Everything a chosen ~/.ssh/config entry can fill in, as a form patch. */
export function hostPatch(host: SshHostHint): Partial<FormState> {
  const patch: Partial<FormState> = { host: host.hostname }
  if (host.user !== undefined && host.user !== '') patch.user = host.user
  if (host.port !== undefined) patch.port = String(host.port)
  if (host.identityFile !== undefined && host.identityFile !== '') {
    patch.identityFile = host.identityFile
    patch.authMethod = 'identity'
  }
  return patch
}

/**
 * Split a pasted `user@host:port` into its parts, so pasting the thing you'd type
 * after `ssh` fills three fields instead of mangling one. Returns just the host
 * when there is nothing else to take.
 */
export function splitTarget(value: string): Partial<FormState> {
  const trimmed = value.trim().replace(/^ssh:\/\//, '')
  const at = trimmed.lastIndexOf('@')
  const user = at === -1 ? undefined : trimmed.slice(0, at)
  const rest = at === -1 ? trimmed : trimmed.slice(at + 1)
  // A trailing :digits is only a port when what precedes it isn't itself an IPv6
  // address — `fe80::1` is a host, `[fe80::1]:22` is a host and a port.
  const portMatch = /^(.*):(\d{1,5})$/.exec(rest)
  const head = portMatch?.[1]
  const bracketed = head !== undefined && head.startsWith('[') && head.endsWith(']')
  const hasPort = head !== undefined && (!head.includes(':') || bracketed)
  const host = hasPort ? head : rest
  const patch: Partial<FormState> = { host: host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host }
  if (user !== undefined && user !== '') patch.user = user
  if (hasPort && portMatch?.[2] !== undefined) patch.port = portMatch[2]
  return patch
}
