import { describe, expect, it } from 'vitest'
import {
  deriveMemberActivity,
  subagentMatchesMember,
  unmatchedSubagentCount,
} from './team-status.js'
import type { Subagent } from '../store.js'
import type { TeamMemberSummary } from '../api/teams.js'

const members: TeamMemberSummary[] = [
  { name: 'recon', label: 'Recon', description: 'enumerate', model: 'inherit', tools: null },
  { name: 'scanner', label: 'Scanner', description: 'scan', model: 'inherit', tools: null },
  { name: 'reporter', label: 'Reporter', description: 'write', model: 'haiku', tools: ['Read'] },
]

function sub(id: string, description: string, state: Subagent['state']): Subagent {
  return { id, description, state }
}

describe('subagentMatchesMember', () => {
  it('matches an exact name', () => {
    expect(subagentMatchesMember(sub('a', 'recon', 'working'), 'recon')).toBe(true)
  })
  it('matches the name as a leading token in a task description', () => {
    expect(subagentMatchesMember(sub('a', 'recon: enumerate api.example.com', 'working'), 'recon')).toBe(true)
    expect(subagentMatchesMember(sub('a', 'run scanner against hosts', 'working'), 'scanner')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(subagentMatchesMember(sub('a', 'RECON sweep', 'working'), 'recon')).toBe(true)
  })
  it('does not match a mere substring inside another word', () => {
    expect(subagentMatchesMember(sub('a', 'reconnaissance', 'working'), 'recon')).toBe(false)
    expect(subagentMatchesMember(sub('a', 'prescanner', 'working'), 'scanner')).toBe(false)
  })
})

describe('deriveMemberActivity', () => {
  it('marks a member working while a matching sub-agent runs', () => {
    const activity = deriveMemberActivity(members, [sub('t1', 'recon', 'working')])
    expect(activity.find((a) => a.member.name === 'recon')!.status).toBe('working')
    expect(activity.find((a) => a.member.name === 'scanner')!.status).toBe('idle')
  })

  it('marks a member done once its sub-agent finished and none is running', () => {
    const activity = deriveMemberActivity(members, [sub('t1', 'recon', 'done')])
    expect(activity.find((a) => a.member.name === 'recon')!.status).toBe('done')
  })

  it('prefers working over done and counts concurrent tasks', () => {
    const activity = deriveMemberActivity(members, [
      sub('t1', 'recon', 'done'),
      sub('t2', 'recon: deep sweep', 'working'),
      sub('t3', 'recon: ports', 'working'),
    ])
    const recon = activity.find((a) => a.member.name === 'recon')!
    expect(recon.status).toBe('working')
    expect(recon.activeCount).toBe(2)
  })

  it('preserves roster order', () => {
    const activity = deriveMemberActivity(members, [])
    expect(activity.map((a) => a.member.name)).toEqual(['recon', 'scanner', 'reporter'])
  })
})

describe('unmatchedSubagentCount', () => {
  it('counts sub-agents not attributable to any named member', () => {
    const list = [sub('t1', 'recon', 'working'), sub('t2', 'some ad-hoc helper', 'working')]
    expect(unmatchedSubagentCount(members, list)).toBe(1)
  })
})
