import type { BackendProfileInput, BackendTestResult, SshEnrollResult } from './api/backends.js'
import type { EngineConnection } from './lib/connection.js'

export const HOST_TOKEN_KEY = 'exe-host-token'

/** Config that installs `window.executioner` against team-server Host RPC. */
export interface HostBridgeConfig {
  /** Origin of the team server ('' for same-origin relative URLs). */
  baseUrl: string
  bootstrapToken: string
}

type OpenProjectRequest = {
  dir: string
  create: boolean
  name?: string
  icon?: string
  description?: string
  scope?: string
}

function joinUrl(baseUrl: string, path: string): string {
  if (baseUrl === '') return path
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

async function hostJson<T>(config: HostBridgeConfig, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${config.bootstrapToken}`)
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(joinUrl(config.baseUrl, path), { ...init, headers })
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText
    throw new Error(err || `host ${res.status}`)
  }
  return body as T
}

/** Persist the bootstrap token so new tabs on this origin keep Host RPC auth. */
function storeHostToken(token: string): void {
  sessionStorage.setItem(HOST_TOKEN_KEY, token)
  localStorage.setItem(HOST_TOKEN_KEY, token)
}

function readStoredHostToken(): string {
  return sessionStorage.getItem(HOST_TOKEN_KEY) ?? localStorage.getItem(HOST_TOKEN_KEY) ?? ''
}

/**
 * Read `?token=` into storage (and strip it from the URL), then return a
 * HostBridgeConfig aimed at the current origin. Falls back to a one-shot
 * prompt when the printed URL was opened without the query param.
 */
export function resolveHostBridgeConfig(): HostBridgeConfig {
  const url = new URL(window.location.href)
  const fromQuery = url.searchParams.get('token')
  if (fromQuery !== null && fromQuery !== '') {
    storeHostToken(fromQuery)
    url.searchParams.delete('token')
    const cleaned = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', cleaned)
  }

  let bootstrapToken = readStoredHostToken()
  if (bootstrapToken === '') {
    const entered = window.prompt(
      'Paste the bootstrap token from the executioner-host terminal (or reopen the printed portable UI URL).',
    )
    if (entered !== null && entered.trim() !== '') {
      bootstrapToken = entered.trim()
      storeHostToken(bootstrapToken)
    }
  }

  return {
    baseUrl: '',
    bootstrapToken,
  }
}

/** Install `window.executioner` talking to `/host/*` (browser pane still stubbed). */
export function installHostBridge(config: HostBridgeConfig): void {
  const openProject = async (req: OpenProjectRequest): Promise<EngineConnection> => {
    const body = await hostJson<{
      port: number
      token: string
      projectRoot: string
    }>(config, '/host/engagements/open', {
      method: 'POST',
      body: JSON.stringify({
        dir: req.dir,
        create: req.create,
        ...(req.name !== undefined ? { name: req.name } : {}),
      }),
    })
    return { port: body.port, token: body.token, projectRoot: body.projectRoot }
  }

  const closeProject = (req: { dir: string }): void => {
    void hostJson(config, '/host/engagements/close', {
      method: 'POST',
      body: JSON.stringify({ dir: req.dir }),
    }).catch(() => undefined)
  }

  const pickFolder = async (): Promise<string | undefined> => {
    const body = await hostJson<{ path: string | null }>(config, '/host/dialogs/folder', {
      method: 'POST',
    })
    return body.path ?? undefined
  }

  window.executioner = {
    pickFolder,
    openProject,
    closeProject,
    checkAgents: async () => {
      const body = await hostJson<{ agents: { id: string; installed: boolean }[] }>(
        config,
        '/host/agents',
      )
      return body.agents
    },
    testBackend: async (req: { profile: BackendProfileInput; createWorkdir?: boolean }) =>
      hostJson<BackendTestResult>(config, '/host/backends/test', {
        method: 'POST',
        body: JSON.stringify({
          profile: req.profile,
          ...(req.createWorkdir === true ? { createWorkdir: true } : {}),
        }),
      }),
    enrollSsh: async (req: {
      host: string
      user: string
      password: string
      port?: number
    }): Promise<SshEnrollResult> =>
      hostJson<SshEnrollResult>(config, '/host/ssh/enroll', {
        method: 'POST',
        body: JSON.stringify(req),
      }),
    connectionHints: async () =>
      hostJson<{
        sshHosts: { alias: string; hostname: string; user?: string; port?: number; identityFile?: string }[]
        sshKeys: string[]
        defaultUser: string
        dockerImages: string[]
      }>(config, '/host/connection-hints'),
    pickEngagementPhoto: async () => {
      const body = await hostJson<{ dataUrl: string | null }>(config, '/host/engagement-photo/pick', {
        method: 'POST',
      })
      return body.dataUrl
    },
    readEngagementPhoto: async (req: { root: string }) => {
      const body = await hostJson<{ dataUrl: string | null }>(config, '/host/engagement-photo/read', {
        method: 'POST',
        body: JSON.stringify(req),
      })
      return body.dataUrl
    },
    writeEngagementPhoto: async (req: { root: string; dataUrl: string }) => {
      const body = await hostJson<{ dataUrl: string | null }>(config, '/host/engagement-photo/write', {
        method: 'POST',
        body: JSON.stringify(req),
      })
      return body.dataUrl
    },
    clearEngagementPhoto: (req: { root: string }) => {
      void hostJson(config, '/host/engagement-photo/clear', {
        method: 'POST',
        body: JSON.stringify(req),
      }).catch(() => undefined)
    },
    clipboardRead: async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    },
    clipboardWrite: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* secure-context / permission denial */
      }
    },
    browser: {
      place: () => undefined,
      setOccluded: () => undefined,
      operator: async () => undefined,
      onState: () => () => undefined,
    },
    checkForUpdate: async () => null,
    installUpdate: async () => undefined,
    setAppearance: () => undefined,
    // Avoid macOS titlebar inset; window controls no-op in the browser.
    platform: 'linux',
    windowControl: () => undefined,
    onMaximizedChange: () => () => undefined,
  }
}
