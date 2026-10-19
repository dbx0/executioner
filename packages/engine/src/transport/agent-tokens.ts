import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { PROFILE_TOOLS, type AgentProfile } from '../mcp/toolset.js'

/** Scoped tokens carry this prefix so one is never mistaken for the master token. */
const PREFIX = 'exa_'

/** What a scoped agent token lets its holder do. */
export interface AgentGrant {
  profile: AgentProfile
  /** The MCP tools this session may call. */
  tools: ReadonlySet<string>
  /** The terminal or run id the session's hook events must carry, when it has hooks. */
  sessionId?: string
  /** Epoch ms after which the token is refused. Absent: valid until revoked. */
  expiresAt?: number
}

export interface IssuedAgentToken {
  token: string
  /** Invalidate the token now. Safe to call more than once. */
  revoke(): void
}

interface Entry {
  digest: Buffer
  grant: AgentGrant
}

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * The per-session tokens handed to spawned agents instead of the engine's
 * master token. A scoped token opens only the MCP endpoint and the hook event
 * endpoint, and only the tools of its profile. Tokens live in memory, so an
 * engine restart revokes all of them; the launcher revokes each one when its
 * agent process exits, and headless ones also carry an expiry as a backstop.
 *
 * Only SHA-256 digests are kept. A presented token is checked against every
 * live digest with `timingSafeEqual` and no early exit, so the time taken does
 * not depend on how much of any token matched.
 */
export class AgentTokenRegistry {
  private readonly entries = new Set<Entry>()

  constructor(private readonly now: () => number = Date.now) {}

  issue(input: { profile: AgentProfile; sessionId?: string; ttlMs?: number }): IssuedAgentToken {
    this.prune()
    const token = PREFIX + randomBytes(32).toString('base64url')
    const grant: AgentGrant = {
      profile: input.profile,
      tools: new Set(PROFILE_TOOLS[input.profile]),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.ttlMs === undefined ? {} : { expiresAt: this.now() + input.ttlMs }),
    }
    const entry: Entry = { digest: digestOf(token), grant }
    this.entries.add(entry)
    return { token, revoke: () => void this.entries.delete(entry) }
  }

  /** The grant for a presented token, or undefined when it is unknown, revoked or expired. */
  verify(presented: string): AgentGrant | undefined {
    if (!presented.startsWith(PREFIX)) return undefined
    const digest = digestOf(presented)
    let found: Entry | undefined
    for (const entry of this.entries) {
      if (timingSafeEqual(entry.digest, digest)) found = entry
    }
    if (found === undefined) return undefined
    if (found.grant.expiresAt !== undefined && this.now() >= found.grant.expiresAt) {
      this.entries.delete(found)
      return undefined
    }
    return found.grant
  }

  /** How many tokens are live, for tests and diagnostics. */
  get size(): number {
    this.prune()
    return this.entries.size
  }

  private prune(): void {
    const now = this.now()
    for (const entry of this.entries) {
      if (entry.grant.expiresAt !== undefined && now >= entry.grant.expiresAt) this.entries.delete(entry)
    }
  }
}
