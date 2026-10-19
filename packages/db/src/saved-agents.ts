import { asc, eq } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { savedAgents } from './tables.js'

/** Where a saved agent lives: the engagement DB (`local`) or the user file (`global`). */
export type SavedAgentScope = 'local' | 'global'

/** The base CLI a saved agent runs on. */
export type SavedAgentBase = 'claude' | 'codex' | 'opencode' | 'gemini' | 'cursor' | 'hermes'

/**
 * One sub-agent in a team roster. Mirrors a Claude Code custom subagent: `name`
 * is the delegation name, `description` tells the lead when to delegate, `prompt`
 * is the member's system prompt, and `model`/`tools` are optional pins (absent =
 * inherit the lead's). Present only on team agents.
 */
export interface SavedAgentMember {
  name: string
  description: string
  prompt: string
  model?: string
  tools?: string[]
}

/**
 * A reusable agent definition the user can manage and run against targets. It
 * carries the base CLI (`agent`), the instructions (`prompt`) and optional
 * model/tools overrides. A team is a Claude launch (`agent` = `claude-team:<id>`)
 * that additionally carries a `members` roster the lead orchestrates. `scope`
 * says which store holds it; the DB repository always yields `local`, the global
 * file yields `global`.
 */
export interface SavedAgent {
  id: string
  name: string
  description: string
  agent: string
  prompt: string
  model?: string
  tools?: string[]
  members?: SavedAgentMember[]
  scope: SavedAgentScope
  createdAt: string
  updatedAt: string
  /**
   * Fingerprint of the roster this agent was seeded with. Only set by the
   * global file store on a built-in team seed, and only used there: it is how a
   * later version tells an untouched seed (safe to refresh in place) from one
   * the user has edited. Editing an agent drops it, which is the intent.
   */
  seedHash?: string
}

/** Fields accepted when creating/updating a saved agent (no id/timestamps). */
export interface SavedAgentInput {
  name: string
  description?: string
  agent: string
  prompt: string
  model?: string | undefined
  tools?: string[] | undefined
  members?: SavedAgentMember[] | undefined
}

type Row = typeof savedAgents.$inferSelect

/** True for a bare team base (`claude-team`, `opencode-team`) with no id suffix. */
function isBareTeam(agent: string): boolean {
  return agent === 'claude-team' || agent === 'opencode-team'
}

function parseTools(raw: string | null): string[] | undefined {
  if (raw === null || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) return parsed as string[]
  } catch {
    /* fall through */
  }
  return undefined
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((t) => typeof t === 'string')

/** True for a roster entry with the fields a launch reads, correctly typed. */
function isMember(value: unknown): value is SavedAgentMember {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.name === 'string' &&
    typeof m.description === 'string' &&
    typeof m.prompt === 'string' &&
    (m.model === undefined || typeof m.model === 'string') &&
    (m.tools === undefined || isStringList(m.tools))
  )
}

/** Parse the members JSON column into a roster, tolerating a malformed value. */
function parseMembers(raw: string | null): SavedAgentMember[] | undefined {
  if (raw === null || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return undefined
    // Every string field a launch reads is checked, not only the name: a roster
    // edited by hand or by an older build must not reach `prompt.trim()` as a number.
    const members = parsed.filter(isMember)
    return members.length > 0 ? members : undefined
  } catch {
    return undefined
  }
}

/** Map a DB row to a `local`-scoped SavedAgent, omitting empty optionals. */
function toAgent(r: Row): SavedAgent {
  const tools = parseTools(r.tools)
  const members = parseMembers(r.members)
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    agent: r.agent,
    prompt: r.prompt,
    ...(r.model !== null && r.model !== '' ? { model: r.model } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(members !== undefined ? { members } : {}),
    scope: 'local',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

/**
 * CRUD for the engagement's `local` saved agents. Global agents are stored in a
 * user-level file instead (see the engine's saved-agents-store); the route
 * merges both. `tools` is serialized to a JSON text column.
 */
export class SavedAgentRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  list(): SavedAgent[] {
    return this.orm.select().from(savedAgents).orderBy(asc(savedAgents.createdAt)).all().map(toAgent)
  }

  get(id: string): SavedAgent | undefined {
    const row = this.orm.select().from(savedAgents).where(eq(savedAgents.id, id)).get()
    return row === undefined ? undefined : toAgent(row)
  }

  create(input: SavedAgentInput): SavedAgent {
    const now = isoNow()
    const id = newId()
    const tools = input.tools !== undefined && input.tools.length > 0 ? input.tools : undefined
    const members = input.members !== undefined && input.members.length > 0 ? input.members : undefined
    // A bare team (`claude-team`, `opencode-team`) gains a unique id suffix so the
    // launch can find this exact team's roster (seeds keep their descriptive id).
    const agent = isBareTeam(input.agent) ? `${input.agent}:${id}` : input.agent
    this.orm
      .insert(savedAgents)
      .values({
        id,
        name: input.name,
        description: input.description ?? '',
        agent,
        prompt: input.prompt,
        model: input.model !== undefined && input.model !== '' ? input.model : null,
        tools: tools !== undefined ? JSON.stringify(tools) : null,
        members: members !== undefined ? JSON.stringify(members) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return this.get(id)!
  }

  update(id: string, input: SavedAgentInput): SavedAgent | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    const tools = input.tools !== undefined && input.tools.length > 0 ? input.tools : undefined
    const members = input.members !== undefined && input.members.length > 0 ? input.members : undefined
    // Keep the existing team's id-qualified agent string; never regenerate it.
    const agent = isBareTeam(input.agent) ? existing.agent : input.agent
    this.orm
      .update(savedAgents)
      .set({
        name: input.name,
        description: input.description ?? '',
        agent,
        prompt: input.prompt,
        model: input.model !== undefined && input.model !== '' ? input.model : null,
        tools: tools !== undefined ? JSON.stringify(tools) : null,
        members: members !== undefined ? JSON.stringify(members) : null,
        updatedAt: isoNow(),
      })
      .where(eq(savedAgents.id, id))
      .run()
    return this.get(id)
  }

  remove(id: string): void {
    this.orm.delete(savedAgents).where(eq(savedAgents.id, id)).run()
  }
}
