import { describe, expect, it } from 'vitest'
import { SavedAgentsStore, rosterFingerprint, type StoreFs } from './saved-agents-store.js'
import { BUILTIN_TEAMS } from './agent-team.js'

/** In-memory fs shim: a Map from path → contents. */
function memFs(seed: Record<string, string> = {}): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    readFileSync(path: string): string {
      const v = files.get(path)
      if (v === undefined) throw new Error('ENOENT')
      return v
    },
    writeFileSync(path: string, data: string): void {
      files.set(path, data)
    },
    mkdirSync(): void {
      /* no-op */
    },
  }
}

const HOME = '/home/tester'
const AGENTS_PATH = '/home/tester/.executioner/agents.json'

describe('SavedAgentsStore', () => {
  it('seeds one runnable agent per built-in team when absent', () => {
    const fs = memFs()
    const store = new SavedAgentsStore({ home: HOME, fs })
    const agents = store.seedGlobalIfMissing()

    // One saved agent per team, each a `claude-team:<id>` launch carrying a roster.
    expect(new Set(agents.map((a) => a.name))).toEqual(new Set(BUILTIN_TEAMS.map((t) => t.name)))
    expect(new Set(agents.map((a) => a.agent))).toEqual(new Set(BUILTIN_TEAMS.map((t) => `claude-team:${t.id}`)))
    expect(agents.every((a) => a.scope === 'global')).toBe(true)
    expect(agents.every((a) => a.prompt.trim() !== '')).toBe(true)
    expect(agents.every((a) => (a.members?.length ?? 0) > 0)).toBe(true)
    // File now persisted.
    expect(fs.files.has(AGENTS_PATH)).toBe(true)
  })

  it('refreshes an untouched built-in roster when the shipped prompts change, keeping the record id', () => {
    const now = '2020-01-01T00:00:00.000Z'
    const team = BUILTIN_TEAMS[0]!
    // A seed written by an earlier version: the roster it shipped with, stamped
    // with that roster's fingerprint.
    const stale = team.members.map((m) => ({ name: m.name, description: m.description, prompt: `old ${m.name} prompt` }))
    const seeded = [
      {
        id: 'keep-me',
        name: team.name,
        description: team.description,
        agent: `claude-team:${team.id}`,
        prompt: 'lead',
        members: stale,
        scope: 'global',
        createdAt: now,
        updatedAt: now,
        seedHash: rosterFingerprint(stale),
      },
    ]
    const fs = memFs({ [AGENTS_PATH]: JSON.stringify(seeded) })
    const agents = new SavedAgentsStore({ home: HOME, fs }).list()

    const refreshed = agents.find((a) => a.agent === `claude-team:${team.id}`)!
    expect(refreshed.id).toBe('keep-me')
    expect(refreshed.members?.map((m) => m.prompt)).toEqual(team.members.map((m) => m.prompt))
    // Re-stamped, so the next revision can recognise it as untouched too.
    expect(refreshed.seedHash).toBe(rosterFingerprint(refreshed.members))
    expect(refreshed.updatedAt).not.toBe(now)
  })

  it('leaves a built-in roster the user has edited exactly as they left it', () => {
    const now = '2020-01-01T00:00:00.000Z'
    const team = BUILTIN_TEAMS[0]!
    const mine = [{ name: 'recon', description: 'mine', prompt: 'my own prompt' }]
    const edited = [
      {
        id: 'keep-me',
        name: team.name,
        description: team.description,
        agent: `claude-team:${team.id}`,
        prompt: 'lead',
        members: mine,
        scope: 'global',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const fs = memFs({ [AGENTS_PATH]: JSON.stringify(edited) })
    const agents = new SavedAgentsStore({ home: HOME, fs }).list()

    const kept = agents.find((a) => a.agent === `claude-team:${team.id}`)!
    expect(kept.members).toEqual(mine)
    expect(kept.updatedAt).toBe(now)
  })

  it('recognises a roster seeded before seedHash existed via the shipped-roster registry', () => {
    // The rosters currently shipped are registered, so a seed carrying one and
    // no seedHash is still identified as untouched (this is the upgrade path for
    // every file written before the stamp was introduced).
    const fs = memFs()
    const seeded = new SavedAgentsStore({ home: HOME, fs }).list()
    const unstamped = seeded.map(({ seedHash: _drop, ...rest }) => rest)
    const fs2 = memFs({ [AGENTS_PATH]: JSON.stringify(unstamped) })
    const agents = new SavedAgentsStore({ home: HOME, fs: fs2 }).list()
    for (const team of BUILTIN_TEAMS) {
      const rec = agents.find((a) => a.agent === `claude-team:${team.id}`)!
      expect(rec.members?.map((m) => m.prompt)).toEqual(team.members.map((m) => m.prompt))
    }
  })

  it('upgrades an older member-less built-in team seed in place, keeping its id', () => {
    const now = new Date().toISOString()
    const team = BUILTIN_TEAMS[0]!
    const legacy = [
      { id: 'keep-me', name: team.name, description: team.description, agent: `claude-team:${team.id}`, prompt: 'lead', scope: 'global', createdAt: now, updatedAt: now },
    ]
    const fs = memFs({ [AGENTS_PATH]: JSON.stringify(legacy) })
    const store = new SavedAgentsStore({ home: HOME, fs })
    const agents = store.list()
    const upgraded = agents.find((a) => a.id === 'keep-me')!
    expect(upgraded.members?.map((m) => m.name)).toEqual(team.members.map((m) => m.name))
    // Only the members were attached; no duplicate team was added.
    expect(agents.filter((a) => a.agent === `claude-team:${team.id}`)).toHaveLength(1)
  })

  it('migrates an old member-flattened file: drops untouched member seeds, keeps custom agents, adds teams', () => {
    const now = new Date().toISOString()
    const member = BUILTIN_TEAMS[0]!.members[0]!
    const legacy = [
      // An untouched auto-seed of a team member — should be pruned.
      { id: 'm1', name: member.name, description: member.description, agent: 'claude', prompt: member.prompt, scope: 'global', createdAt: now, updatedAt: now },
      // A real custom agent (name collides but prompt differs) — must survive.
      { id: 'c1', name: 'recon', description: 'mine', agent: 'claude', prompt: 'totally custom prompt', scope: 'global', createdAt: now, updatedAt: now },
    ]
    const fs = memFs({ [AGENTS_PATH]: JSON.stringify(legacy) })
    const store = new SavedAgentsStore({ home: HOME, fs })
    const agents = store.list()

    expect(agents.find((a) => a.id === 'm1')).toBeUndefined()
    expect(agents.find((a) => a.id === 'c1')?.prompt).toBe('totally custom prompt')
    for (const t of BUILTIN_TEAMS) {
      expect(agents.some((a) => a.agent === `claude-team:${t.id}`)).toBe(true)
    }
  })

  it('is idempotent: a second read returns the persisted set, not a re-seed', () => {
    const fs = memFs()
    const store = new SavedAgentsStore({ home: HOME, fs })
    const first = store.list()
    const second = store.list()
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id))
  })

  it('round-trips create/update/remove', () => {
    const fs = memFs()
    const store = new SavedAgentsStore({ home: HOME, fs })
    store.seedGlobalIfMissing()
    const created = store.create({ name: 'Custom', agent: 'codex', prompt: 'go', tools: ['Read'] })
    expect(created.scope).toBe('global')
    expect(store.get(created.id)?.tools).toEqual(['Read'])

    const updated = store.update(created.id, { name: 'Custom2', agent: 'codex', prompt: 'go2' })
    expect(updated?.name).toBe('Custom2')
    expect(updated?.tools).toBeUndefined()

    store.remove(created.id)
    expect(store.get(created.id)).toBeUndefined()
  })

  it('tolerates a malformed file by re-seeding', () => {
    const fs = memFs({ [AGENTS_PATH]: 'not json {' })
    const store = new SavedAgentsStore({ home: HOME, fs })
    const agents = store.list()
    expect(agents.length).toBeGreaterThan(0)
    expect(agents.every((a) => a.scope === 'global')).toBe(true)
  })
})
