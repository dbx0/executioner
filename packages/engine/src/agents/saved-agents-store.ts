import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { globalLayout } from '@exe/protocol'
import { isoNow, newId } from '@exe/protocol'
import type { SavedAgent, SavedAgentInput, SavedAgentMember } from '@exe/db'
import { BUILTIN_TEAMS, type AgentTeam } from './agent-team.js'

/** The set of built-in team ids, used to recognise seeded team agents. */
const BUILTIN_TEAM_IDS = new Set(BUILTIN_TEAMS.map((t) => t.id))

/** True for a bare team base (`claude-team`, `opencode-team`) with no id suffix. */
function isBareTeam(agent: string): boolean {
  return agent === 'claude-team' || agent === 'opencode-team'
}

/** Flatten a built-in team's roster into the saved-agent member shape. */
function membersOf(team: AgentTeam): SavedAgentMember[] {
  return team.members.map((m) => {
    const member: SavedAgentMember = { name: m.name, description: m.description, prompt: m.prompt }
    if (m.model !== undefined && m.model !== 'inherit') member.model = m.model
    if (m.tools !== undefined && m.tools.length > 0) member.tools = [...m.tools]
    return member
  })
}

/**
 * A stable fingerprint of a roster. Two rosters hash equal only when every
 * member's name, description, prompt, model pin and tool allowlist match, so it
 * is a reliable "has this been edited?" test.
 */
export function rosterFingerprint(members: readonly SavedAgentMember[] | undefined): string {
  const canonical = (members ?? []).map((m) => [m.name, m.description, m.prompt, m.model ?? '', (m.tools ?? []).join(',')])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

/**
 * Every built-in roster this app has ever seeded, keyed by team id. A stored
 * team whose roster hashes to one of these was written by us and never edited,
 * so a prompt revision can be pushed into it safely; anything else is the
 * user's own work and is left alone.
 *
 * APPEND a fingerprint here whenever a built-in team's roster changes, and
 * never remove one — dropping an entry makes an older untouched seed look
 * hand-edited, and it would then keep the stale prompts forever. Recompute with
 * `rosterFingerprint(membersOf(team))`.
 */
const SHIPPED_ROSTERS: Readonly<Record<string, readonly string[]>> = {
  // Initial roster (one-line member prompts).      Bug-bounty methodology rewrite.
  'recon-strike': ['9190164bb422120f', 'e6248457e8da4dc7'],
  'web-appsec': ['690ffb975497fd81', '4d898ad37d299d81'],
  'code-audit': ['2b1add72463bc4f9', '2d7d21c0792186a4'],
}

/** The built-in team id encoded in a `claude-team:<id>` agent string, if any. */
function builtinTeamIdOf(agent: string): string | undefined {
  if (!agent.startsWith('claude-team:')) return undefined
  const id = agent.slice('claude-team:'.length)
  return BUILTIN_TEAM_IDS.has(id) ? id : undefined
}

/**
 * A minimal filesystem surface so the store can be exercised in tests with an
 * in-memory shim. Mirrors the subset of `node:fs` the store touches.
 */
export interface StoreFs {
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
  mkdirSync(path: string, options: { recursive: true }): void
}

const nodeFs: StoreFs = {
  readFileSync: (p, e) => readFileSync(p, e),
  writeFileSync: (p, d, e) => writeFileSync(p, d, e),
  mkdirSync: (p, o) => {
    mkdirSync(p, o)
  },
}

export interface SavedAgentsStoreOptions {
  /** Override the user's home dir (tests). Defaults to the user-level directory. */
  home?: string
  /** Override the fs surface (tests). Defaults to node:fs. */
  fs?: StoreFs
}

/**
 * The global saved-agent store: an array persisted to
 * `~/.executioner/agents.json`, shared across engagements. On first read (file
 * absent or unreadable) it is seeded from the built-in Claude teams. All fs
 * access is guarded; a broken file degrades to a re-seed or an empty list
 * rather than throwing, so a route reading it never crashes.
 */
export class SavedAgentsStore {
  private readonly fs: StoreFs
  private readonly path: string

  constructor(options: SavedAgentsStoreOptions = {}) {
    this.fs = options.fs ?? nodeFs
    // Tests pin a home; everyone else gets the user-level directory (which
    // EXECUTIONER_HOME can move).
    this.path = options.home === undefined ? globalLayout.agents() : join(options.home, '.executioner', 'agents.json')
  }

  /**
   * Seed one saved agent per built-in team. A team is a runnable Claude launch
   * (`agent: 'claude-team:<id>'`); its members are the sub-agents the lead
   * orchestrates, so the roster is not flattened into loose agents here.
   */
  private teamSeed(team: AgentTeam): SavedAgent {
    const now = isoNow()
    const members = membersOf(team)
    return {
      id: newId(),
      name: team.name,
      description: team.description,
      agent: `claude-team:${team.id}`,
      prompt: `Lead the ${team.name} team against the given target. Delegate to the appropriate specialists, then consolidate their evidence into the project findings.`,
      members,
      scope: 'global',
      createdAt: now,
      updatedAt: now,
      seedHash: rosterFingerprint(members),
    }
  }

  private teamSeedAgents(): SavedAgent[] {
    return BUILTIN_TEAMS.map((team) => this.teamSeed(team))
  }

  /**
   * True when the stored roster of a built-in team seed is still exactly one we
   * shipped, i.e. the user has not edited it. Checked against this record's own
   * `seedHash` first (set from the version that seeded it) and then against the
   * shipped-roster registry, which is what lets a seed written before `seedHash`
   * existed still be recognised.
   */
  private isUntouchedTeamSeed(a: SavedAgent, teamId: string): boolean {
    const hash = rosterFingerprint(a.members)
    if (a.seedHash === hash) return true
    return (SHIPPED_ROSTERS[teamId] ?? []).includes(hash)
  }

  /**
   * True when `a` is an untouched auto-seed of a built-in team *member* — the
   * pre-teams seeding flattened members into loose agents. We recognise those by
   * an exact name+prompt match so a real custom agent is never pruned. Matching
   * against the *current* prompts is deliberate: any file old enough to still
   * hold these rows was pruned the first time it was opened by a version that
   * had teams, so this only ever fires on the roster it shipped with.
   */
  private isLegacyMemberSeed(a: SavedAgent): boolean {
    if (a.agent !== 'claude') return false
    return BUILTIN_TEAMS.some((t) => t.members.some((m) => m.name === a.name && m.prompt === a.prompt))
  }

  /**
   * Bring an existing file up to date: drop untouched legacy member seeds and
   * add any built-in team that isn't present yet (matched by its
   * `claude-team:<id>` agent string). Returns the migrated list and whether it
   * changed, so the caller only rewrites when needed (keeping list() idempotent).
   */
  private migrate(agents: SavedAgent[]): { agents: SavedAgent[]; changed: boolean } {
    let changed = false
    // 1. Drop untouched legacy member seeds (the pre-teams flattening).
    const pruned = agents.filter((a) => !this.isLegacyMemberSeed(a))
    if (pruned.length !== agents.length) changed = true
    // 2. Attach the roster to any older built-in team seed that predates
    //    editable members, so the built-in teams become editable in place.
    const upgraded = pruned.map((a) => {
      const bid = builtinTeamIdOf(a.agent)
      if (bid !== undefined && (a.members === undefined || a.members.length === 0)) {
        const team = BUILTIN_TEAMS.find((t) => t.id === bid)
        if (team !== undefined) {
          changed = true
          return { ...a, members: membersOf(team) }
        }
      }
      return a
    })
    // 3. Push a built-in prompt revision into any seed the user has not edited,
    //    so an existing install picks up an improved roster instead of keeping
    //    the prompts it happened to be seeded with. An edited roster is left
    //    exactly as the user left it.
    const refreshed = upgraded.map((a) => {
      const bid = builtinTeamIdOf(a.agent)
      if (bid === undefined) return a
      const team = BUILTIN_TEAMS.find((t) => t.id === bid)
      if (team === undefined) return a
      const current = membersOf(team)
      const currentHash = rosterFingerprint(current)
      if (rosterFingerprint(a.members) === currentHash) return a
      if (!this.isUntouchedTeamSeed(a, bid)) return a
      changed = true
      return { ...a, members: current, seedHash: currentHash, updatedAt: isoNow() }
    })
    // 4. Add any built-in team not represented yet (matched by its agent string).
    const present = new Set(refreshed.map((a) => a.agent))
    const missing = BUILTIN_TEAMS.filter((t) => !present.has(`claude-team:${t.id}`)).map((t) => this.teamSeed(t))
    if (missing.length > 0) changed = true
    return { agents: [...missing, ...refreshed], changed }
  }

  /** Read the raw array from disk, or undefined when the file is absent/malformed. */
  private readRaw(): SavedAgent[] | undefined {
    let text: string
    try {
      text = this.fs.readFileSync(this.path, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed)) return undefined
      return parsed
        .filter((x): x is SavedAgent => typeof x === 'object' && x !== null)
        .map((x) => ({ ...x, scope: 'global' as const }))
    } catch {
      return undefined
    }
  }

  private write(agents: SavedAgent[]): void {
    try {
      this.fs.mkdirSync(dirname(this.path), { recursive: true })
      this.fs.writeFileSync(this.path, `${JSON.stringify(agents, null, 2)}\n`, 'utf8')
    } catch {
      /* best-effort: a failed write must never crash the caller */
    }
  }

  /** Ensure the file exists, seeding it from the built-ins when absent/broken. */
  seedGlobalIfMissing(): SavedAgent[] {
    const existing = this.readRaw()
    if (existing !== undefined) {
      const { agents, changed } = this.migrate(existing)
      if (changed) this.write(agents)
      return agents
    }
    const seeded = this.teamSeedAgents()
    this.write(seeded)
    return seeded
  }

  /** All global agents (seeding on first read). */
  list(): SavedAgent[] {
    return this.seedGlobalIfMissing()
  }

  get(id: string): SavedAgent | undefined {
    return this.list().find((a) => a.id === id)
  }

  create(input: SavedAgentInput): SavedAgent {
    const agents = this.list()
    const now = isoNow()
    const id = newId()
    // A bare team (`claude-team`, `opencode-team`) gains a unique id suffix so the
    // launch can resolve this exact team's roster (seeds keep their descriptive id).
    const agent: SavedAgent = {
      id,
      name: input.name,
      description: input.description ?? '',
      agent: isBareTeam(input.agent) ? `${input.agent}:${id}` : input.agent,
      prompt: input.prompt,
      scope: 'global',
      createdAt: now,
      updatedAt: now,
    }
    if (input.model !== undefined && input.model !== '') agent.model = input.model
    if (input.tools !== undefined && input.tools.length > 0) agent.tools = [...input.tools]
    if (input.members !== undefined && input.members.length > 0) agent.members = input.members
    this.write([...agents, agent])
    return agent
  }

  update(id: string, input: SavedAgentInput): SavedAgent | undefined {
    const agents = this.list()
    const idx = agents.findIndex((a) => a.id === id)
    if (idx === -1) return undefined
    const prev = agents[idx]!
    const next: SavedAgent = {
      id: prev.id,
      name: input.name,
      description: input.description ?? '',
      // Keep the existing team's id-qualified agent string; never regenerate it.
      agent: isBareTeam(input.agent) ? prev.agent : input.agent,
      prompt: input.prompt,
      scope: 'global',
      createdAt: prev.createdAt,
      updatedAt: isoNow(),
    }
    if (input.model !== undefined && input.model !== '') next.model = input.model
    if (input.tools !== undefined && input.tools.length > 0) next.tools = [...input.tools]
    if (input.members !== undefined && input.members.length > 0) next.members = input.members
    const copy = [...agents]
    copy[idx] = next
    this.write(copy)
    return next
  }

  /** Insert an already-formed agent (used when moving one from the DB). */
  add(agent: SavedAgent): SavedAgent {
    const agents = this.list()
    const scoped: SavedAgent = { ...agent, scope: 'global' }
    this.write([...agents, scoped])
    return scoped
  }

  remove(id: string): void {
    const agents = this.list()
    this.write(agents.filter((a) => a.id !== id))
  }
}
