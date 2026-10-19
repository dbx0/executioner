import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSession, loadSessions, saveFiles, saveRecents, saveSession, saveSessions } from '../persistence.js'
import type { AppState } from '../types.js'

const ROOT = '/tmp/acme'
const connection = { port: 4599, token: 't'.repeat(40), projectRoot: ROOT }

/**
 * The engine's `GET /api/project` is the only source of an engagement's real
 * name and emoji icon — they live in its config.json, not in the folder name.
 * `reply` is what that endpoint returns, or a throw for an unreachable engine.
 */
let reply: (() => { name: string; icon: string | null }) | 'unreachable' = 'unreachable'

/** Counter behind the ids the mocked engine hands out for created terminals. */
let created = 0

/** Stands in for `.executioner/icon.png` inside the engagement folder: what the
 *  main process would read back, write, or delete. */
let storedPhoto: string | null = null

const PHOTO = 'data:image/png;base64,AAAA'

/** The preload surface, with the photo calls backed by `storedPhoto`. */
function executioner(): Record<string, unknown> {
  return {
    openProject: vi.fn(async () => connection),
    closeProject: vi.fn(),
    pickFolder: vi.fn(),
    pickEngagementPhoto: vi.fn(async () => null),
    readEngagementPhoto: vi.fn(async () => storedPhoto),
    writeEngagementPhoto: vi.fn(async ({ dataUrl }: { dataUrl: string }) => {
      storedPhoto = dataUrl
      return dataUrl
    }),
    clearEngagementPhoto: vi.fn(() => {
      storedPhoto = null
    }),
  }
}

const engine = {
  get: vi.fn(async (url: string) => {
    if (url !== '/project') return { data: [] }
    if (reply === 'unreachable') throw new Error('ECONNREFUSED')
    return { data: { root: ROOT, ...reply() } }
  }),
  post: vi.fn(async (url: string) => (url === '/terminals' ? { data: { id: `t${String(++created)}` } } : { data: {} })),
  patch: vi.fn(async () => ({ data: {} })),
  delete: vi.fn(async () => ({ data: {} })),
}

vi.mock('axios', () => ({ default: { create: () => engine } }))

/**
 * A fresh store per test: `restoreSession` guards itself with a closure flag so
 * it only ever runs once per module instance.
 */
async function freshStore(): Promise<{ getState: () => AppState }> {
  vi.resetModules()
  const mod = (await import('../create.js')) as { useApp: { getState: () => AppState } }
  return mod.useApp
}

/** Let the metadata refresh settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('engagement name + icon', () => {
  beforeEach(() => {
    localStorage.clear()
    reply = 'unreachable'
    storedPhoto = null
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        executioner: executioner(),
      }),
    )
  })

  it('remembers the chosen icon the moment an engagement is created', async () => {
    // The recent entry must carry the icon without waiting on the engine: the
    // user picked it, so there is nothing to look up.
    const useApp = await freshStore()
    await useApp.getState().createEngagement({ dir: ROOT, name: 'Acme', icon: '🧬', description: '', scope: '' })

    expect(useApp.getState().open[0]?.icon).toBe('🧬')
    expect(useApp.getState().engagementIcon).toBe('🧬')
    expect(useApp.getState().recents[0]?.icon).toBe('🧬')
  })

  it('restores the configured name and icon, not the folder basename', async () => {
    // Regression: restoreSession built each engagement from basename(root) with
    // no icon and never refreshed it, so every reload dropped the emoji and the
    // engagement's real name for the rest of the session.
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = () => ({ name: 'Acme Corp', icon: '🧬' })

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.name).toBe('Acme Corp')
    expect(useApp.getState().open[0]?.icon).toBe('🧬')
  })

  it('falls back to the remembered icon when the engine cannot be reached', async () => {
    // A restore that cannot read config.json should still show what it knew,
    // rather than dropping back to initials over a folder basename.
    saveRecents([{ root: ROOT, name: 'Acme Corp', icon: '🧬', lastOpenedAt: Date.now() }])
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = 'unreachable'

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.name).toBe('Acme Corp')
    expect(useApp.getState().open[0]?.icon).toBe('🧬')
  })

  it('clears a remembered icon when the engagement no longer has one', async () => {
    saveRecents([{ root: ROOT, name: 'Acme Corp', icon: '🧬', lastOpenedAt: Date.now() }])
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = () => ({ name: 'Acme Corp', icon: null })

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.icon).toBeUndefined()
  })

  it('stores the chosen photo in the engagement folder as it is created', async () => {
    const useApp = await freshStore()
    await useApp
      .getState()
      .createEngagement({ dir: ROOT, name: 'Acme', photo: PHOTO, description: '', scope: '' })

    expect(storedPhoto).toBe(PHOTO)
    expect(useApp.getState().open[0]?.photo).toBe(PHOTO)
    expect(useApp.getState().engagementPhoto).toBe(PHOTO)
    expect(useApp.getState().recents[0]?.photo).toBe(PHOTO)
  })

  it('reads the photo back out of the folder every time the engagement opens', async () => {
    // Nothing is remembered about this engagement: the badge has to come from
    // the folder, the same way the emoji comes from config.json.
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = () => ({ name: 'Acme Corp', icon: null })
    storedPhoto = PHOTO

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.photo).toBe(PHOTO)
    expect(useApp.getState().recents[0]?.photo).toBe(PHOTO)
  })

  it('drops a remembered photo that is no longer in the folder', async () => {
    saveRecents([{ root: ROOT, name: 'Acme Corp', photo: PHOTO, lastOpenedAt: Date.now() }])
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = () => ({ name: 'Acme Corp', icon: null })
    storedPhoto = null

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.photo).toBeUndefined()
    expect(useApp.getState().recents[0]?.photo).toBeUndefined()
  })

  it('keeps the remembered photo when the engine cannot be reached', async () => {
    // The photo lives in the folder, not behind the engine, so an engine that
    // will not answer must not cost the engagement its badge.
    saveRecents([{ root: ROOT, name: 'Acme Corp', photo: PHOTO, lastOpenedAt: Date.now() }])
    saveSession([{ root: ROOT }] as never, ROOT)
    reply = 'unreachable'
    storedPhoto = PHOTO

    const useApp = await freshStore()
    await useApp.getState().restoreSession()
    await settle()

    expect(useApp.getState().open[0]?.photo).toBe(PHOTO)
  })

  it('an emoji chosen later replaces the photo, in the folder as well as on screen', async () => {
    const useApp = await freshStore()
    await useApp
      .getState()
      .createEngagement({ dir: ROOT, name: 'Acme', photo: PHOTO, description: '', scope: '' })
    await settle() // let the post-create metadata refresh land first
    reply = () => ({ name: 'Acme', icon: '🧬' })

    await useApp.getState().updateEngagementMeta({ name: 'Acme', icon: '🧬', photo: '' })

    expect(storedPhoto).toBeNull()
    expect(useApp.getState().open[0]?.photo).toBeUndefined()
    expect(useApp.getState().recents[0]?.photo).toBeUndefined()
  })
})

describe('opening an engagement by hand', () => {
  beforeEach(() => {
    localStorage.clear()
    reply = 'unreachable'
    storedPhoto = null
    created = 0
    engine.post.mockClear()
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        executioner: executioner(),
      }),
    )
  })

  it('brings back the agents that were open in it last time', async () => {
    // Only the startup restore used to recreate saved sessions, so opening an
    // engagement from the recents list always came up with no agents — and the
    // first session created there then overwrote the saved set.
    saveSessions(ROOT, [{ id: 'old', label: 'claude 1', agent: 'claude', resume: 'conv-1' }])

    const useApp = await freshStore()
    await useApp.getState().openRecent(ROOT)

    expect(useApp.getState().sessions.map((s) => s.label)).toEqual(['claude 1'])
  })

  it('resumes the prior conversation rather than starting the agent fresh', async () => {
    saveSessions(ROOT, [{ id: 'old', label: 'claude 1', agent: 'claude', resume: 'conv-1' }])

    const useApp = await freshStore()
    await useApp.getState().openRecent(ROOT)

    expect(engine.post).toHaveBeenCalledWith('/terminals', { agent: 'claude', resume: 'conv-1' })
  })

  it('brings back the file tabs that were open in it last time', async () => {
    saveFiles(ROOT, [{ id: 'f1', path: 'notes/scope.md', name: 'scope.md' }])

    const useApp = await freshStore()
    await useApp.getState().openRecent(ROOT)

    expect(useApp.getState().files.map((f) => f.path)).toEqual(['notes/scope.md'])
  })
})

describe('a restore that cannot start any engine', () => {
  beforeEach(() => {
    localStorage.clear()
    reply = 'unreachable'
    storedPhoto = null
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        executioner: {
          openProject: vi.fn(async () => {
            throw new Error('engine exited before handshake')
          }),
          closeProject: vi.fn(),
          pickFolder: vi.fn(),
        },
      }),
    )
  })

  it('keeps the remembered engagements instead of erasing them', async () => {
    // A transient engine failure used to wipe the open-engagement list for good,
    // so the next launch came up empty even once the engine was healthy again.
    saveSession([{ root: ROOT }] as never, ROOT)

    const useApp = await freshStore()
    await useApp.getState().restoreSession()

    expect(loadSession().roots).toEqual([ROOT])
    expect(loadSessions(ROOT)).toEqual([])
  })

  it('tells the user why nothing came back', async () => {
    saveSession([{ root: ROOT }] as never, ROOT)

    const useApp = await freshStore()
    await useApp.getState().restoreSession()

    expect(useApp.getState().error).toContain('engine exited before handshake')
  })
})

describe('a restore where only some engines start', () => {
  const OTHER = '/tmp/beta'

  beforeEach(() => {
    localStorage.clear()
    reply = 'unreachable'
    storedPhoto = null
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        executioner: {
          ...executioner(),
          openProject: vi.fn(async (req: { dir: string }) => {
            if (req.dir === OTHER) throw new Error('engine exited before handshake')
            return { port: 4599, token: 't'.repeat(40), projectRoot: req.dir }
          }),
        },
      }),
    )
  })

  it('keeps remembering the engagement whose engine failed', async () => {
    // Dropping it from the persisted set makes one bad start permanent: the
    // engagement is gone from the next launch too, though nothing is wrong with it.
    saveSession([{ root: ROOT }, { root: OTHER }] as never, ROOT)

    const useApp = await freshStore()
    await useApp.getState().restoreSession()

    expect(useApp.getState().open.map((e) => e.root)).toEqual([ROOT])
    expect(loadSession().roots).toEqual([ROOT, OTHER])
  })
})
