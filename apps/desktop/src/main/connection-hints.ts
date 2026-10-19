import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** One `Host` block worth of connection details, as the wizard can apply it. */
export interface SshHostHint {
  /** The `Host` alias the user knows it by. */
  alias: string
  hostname: string
  user?: string
  port?: number
  identityFile?: string
}

export interface ConnectionHints {
  /** Hosts from ~/.ssh/config, concrete ones only (no wildcard patterns). */
  sshHosts: SshHostHint[]
  /** Private keys sitting in ~/.ssh, most conventional first. */
  sshKeys: string[]
  /** This machine's username — the overwhelmingly common remote user too. */
  defaultUser: string
  /** Locally available docker images, empty when docker isn't installed. */
  dockerImages: string[]
}

/** Expand a leading `~` the way ssh does, and make the path absolute. */
function expandHome(path: string, home: string): string {
  if (path.startsWith('~/')) return join(home, path.slice(2))
  if (path === '~') return home
  return isAbsolute(path) ? path : join(home, '.ssh', path)
}

/**
 * Parse the subset of ssh_config the connection form can act on: concrete `Host`
 * aliases and their HostName/User/Port/IdentityFile. Patterns (`Host *`, `web-?`)
 * are skipped — they configure other hosts rather than name one to connect to.
 * Keys are case-insensitive and `=` is accepted as a separator, both per ssh.
 */
export function parseSshConfig(text: string, home = homedir()): SshHostHint[] {
  const hosts: SshHostHint[] = []
  let current: SshHostHint | null = null

  const push = (): void => {
    if (current !== null && current.hostname !== '') hosts.push(current)
    current = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z]+)[\s=]+(.+)$/.exec(line)
    if (match === null) continue
    const keyword = (match[1] ?? '').toLowerCase()
    const value = (match[2] ?? '').trim()

    if (keyword === 'host') {
      push()
      // A single Host line can list several aliases; the first concrete one wins.
      const alias = value.split(/\s+/).find((a) => !a.includes('*') && !a.includes('?'))
      if (alias === undefined) continue
      // HostName defaults to the alias itself when the block doesn't set one.
      current = { alias, hostname: alias }
      continue
    }
    if (current === null) continue
    if (keyword === 'hostname') current.hostname = value
    else if (keyword === 'user') current.user = value
    else if (keyword === 'port' && Number.isFinite(Number(value))) current.port = Number(value)
    else if (keyword === 'identityfile') current.identityFile = expandHome(value, home)
  }
  push()
  return hosts
}

/** Private keys in ~/.ssh: anything with a matching `.pub`, conventional first. */
export function discoverSshKeys(sshDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(sshDir)
  } catch {
    return []
  }
  // A key is "real" when its public half sits next to it — that also filters out
  // config, known_hosts and authorized_keys without hard-coding their names.
  const keys = entries.filter((e) => e.endsWith('.pub')).map((e) => e.slice(0, -4))
  const rank = (name: string): number => {
    const order = ['id_ed25519', 'id_ecdsa', 'id_rsa']
    const at = order.indexOf(name)
    return at === -1 ? order.length : at
  }
  return keys
    .filter((k) => existsSync(join(sshDir, k)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((k) => join(sshDir, k))
}

/** Locally available docker images. Best-effort: no docker means no hints. */
export function listDockerImages(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      execFile(
        'docker',
        ['images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', 'dangling=false'],
        { timeout: 4000, windowsHide: true },
        (err, stdout) => {
          if (err !== null) {
            resolve([])
            return
          }
          const seen = new Set(
            stdout
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l !== '' && !l.startsWith('<none>') && !l.endsWith(':<none>')),
          )
          resolve([...seen].sort((a, b) => a.localeCompare(b)))
        },
      )
    } catch {
      resolve([])
    }
  })
}

/** Everything the connection form can prefill or offer, gathered in one pass. */
export async function collectConnectionHints(home = homedir()): Promise<ConnectionHints> {
  const sshDir = join(home, '.ssh')
  let sshHosts: SshHostHint[] = []
  try {
    sshHosts = parseSshConfig(readFileSync(join(sshDir, 'config'), 'utf8'), home)
  } catch {
    /* no ssh config is normal */
  }
  return {
    sshHosts,
    sshKeys: discoverSshKeys(sshDir),
    defaultUser: userInfo().username,
    dockerImages: await listDockerImages(),
  }
}
