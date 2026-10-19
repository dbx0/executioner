import type { BackendKind, BackendProfile, BackendProfileInput } from '../../../api/backends.js'

/** How an SSH backend authenticates: an existing key file, or a generated key
 * enrolled with a one-time password (the password is never stored). */
export type SshAuthMethod = 'identity' | 'password'

export interface FormState {
  id?: string
  name: string
  kind: BackendKind
  authMethod: SshAuthMethod
  host: string
  port: string
  user: string
  identityFile: string
  /** Transient: used once to enroll a generated key, never persisted. */
  password: string
  image: string
  workdir: string
  env: string
}

export const empty: FormState = {
  name: '',
  kind: 'ssh',
  authMethod: 'identity',
  host: '',
  port: '',
  user: '',
  identityFile: '',
  password: '',
  image: '',
  workdir: '',
  env: '',
}

/** Render an env map as `KEY=VALUE` lines and parse them back. */
function envToText(env: Record<string, string> | undefined): string {
  return env === undefined ? '' : Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

export function toForm(p: BackendProfile): FormState {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    authMethod: 'identity',
    host: p.host ?? '',
    port: p.port === undefined ? '' : String(p.port),
    user: p.user ?? '',
    identityFile: p.identityFile ?? '',
    password: '',
    image: p.image ?? '',
    workdir: p.workdir ?? '',
    env: envToText(p.env),
  }
}

/** Assemble the input payload, omitting empty optionals (exactOptionalPropertyTypes). */
export function toInput(f: FormState): BackendProfileInput {
  const input: BackendProfileInput = { name: f.name.trim(), kind: f.kind }
  if (f.kind === 'local') return input
  if (f.workdir.trim() !== '') input.workdir = f.workdir.trim()
  const env = parseEnv(f.env)
  if (Object.keys(env).length > 0) input.env = env
  if (f.kind === 'ssh') {
    if (f.host.trim() !== '') input.host = f.host.trim()
    if (f.user.trim() !== '') input.user = f.user.trim()
    if (f.port.trim() !== '' && Number.isFinite(Number(f.port))) input.port = Number(f.port)
    if (f.identityFile.trim() !== '') input.identityFile = f.identityFile.trim()
  } else {
    if (f.image.trim() !== '') input.image = f.image.trim()
  }
  return input
}

/** Steps we expect to run, so the UI shows live progress before the result lands. */
export function expectedSteps(kind: BackendKind, sshAuth: SshAuthMethod): string[] {
  if (kind === 'docker') return ['Pull image', 'Run container']
  if (kind === 'ssh') return sshAuth === 'password' ? ['Generate key', 'Install key', 'Verify'] : ['Connect & run']
  return []
}

/** Whether the form holds enough to attempt a test/save. Shared by the settings
 *  modal and the onboarding wizard so both gate on the same rule. */
export function isValid(f: FormState): boolean {
  if (f.name.trim() === '') return false
  if (f.kind === 'local') return true
  if (f.kind === 'ssh') {
    const authOk = f.authMethod === 'password' ? f.password !== '' : true
    return f.host.trim() !== '' && f.user.trim() !== '' && authOk
  }
  return f.image.trim() !== ''
}
