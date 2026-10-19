import type { Subagent } from '../store.js'
import type { TeamMemberSummary } from '../api/teams.js'

/**
 * A member's live status in the team view:
 *  - 'idle'    : never dispatched yet (or dispatch finished and aged out)
 *  - 'working' : a sub-agent for this member is currently running
 *  - 'done'    : a sub-agent for this member finished (and none is running)
 */
export type MemberStatus = 'idle' | 'working' | 'done'

/** A team member paired with its derived live status and running-task count. */
export interface MemberActivity {
  member: TeamMemberSummary
  status: MemberStatus
  /** How many sub-agents are currently matched to this member and working. */
  activeCount: number
}

/**
 * True when a live sub-agent belongs to a member. The engine tags a sub-agent
 * with the Task tool's `description`, which defaults to the delegated
 * `subagent_type` (the member name) when the lead gives no explicit description.
 * We match on the member name appearing as a whole word in the description, so
 * both a bare `recon` and a `recon: enumerate api.example.com` map to `recon`.
 */
export function subagentMatchesMember(sub: Subagent, memberName: string): boolean {
  const name = memberName.toLowerCase()
  const desc = sub.description.toLowerCase()
  if (desc === name) return true
  // Whole-word / prefix-token match: "recon", "recon:", "recon -", "recon task".
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}([^a-z0-9]|$)`).test(desc)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Derive each member's live status from the session's flat sub-agent list.
 * Pure and order-preserving (members keep their roster order) so it can be
 * called from a component body without disturbing Zustand selector stability.
 */
export function deriveMemberActivity(
  members: readonly TeamMemberSummary[],
  subagents: readonly Subagent[],
): MemberActivity[] {
  return members.map((member) => {
    const matched = subagents.filter((s) => subagentMatchesMember(s, member.name))
    const activeCount = matched.filter((s) => s.state === 'working').length
    const status: MemberStatus =
      activeCount > 0 ? 'working' : matched.some((s) => s.state === 'done') ? 'done' : 'idle'
    return { member, status, activeCount }
  })
}

/** Count of sub-agents not attributable to any named member (generic tasks). */
export function unmatchedSubagentCount(
  members: readonly TeamMemberSummary[],
  subagents: readonly Subagent[],
): number {
  return subagents.filter((s) => !members.some((m) => subagentMatchesMember(s, m.name))).length
}
