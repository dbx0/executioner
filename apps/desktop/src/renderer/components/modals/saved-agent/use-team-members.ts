import { useState } from 'react'
import type { SavedAgentMember } from '../../../api/saved-agents.js'

export interface TeamMembers {
  members: SavedAgentMember[]
  addMember: () => void
  updateMember: (i: number, patch: Partial<SavedAgentMember>) => void
  removeMember: (i: number) => void
  /** A team needs at least one member with a name and a prompt. */
  membersValid: boolean
  /** Drop blank members and empty optionals into a clean roster to send. */
  cleanMembers: () => SavedAgentMember[]
}

/** The sub-agent roster of a team, and the edits the modal makes to it. */
export function useTeamMembers(initial: SavedAgentMember[]): TeamMembers {
  const [members, setMembers] = useState<SavedAgentMember[]>(initial)

  const addMember = (): void => setMembers((m) => [...m, { name: '', description: '', prompt: '' }])
  const updateMember = (i: number, patch: Partial<SavedAgentMember>): void =>
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const removeMember = (i: number): void => setMembers((m) => m.filter((_, j) => j !== i))

  const membersValid = members.some((m) => m.name.trim() !== '' && m.prompt.trim() !== '')

  const cleanMembers = (): SavedAgentMember[] =>
    members
      .filter((m) => m.name.trim() !== '' && m.prompt.trim() !== '')
      .map((m) => {
        const out: SavedAgentMember = {
          name: m.name.trim(),
          description: m.description.trim(),
          prompt: m.prompt.trim(),
        }
        if (m.model !== undefined && m.model !== '') out.model = m.model
        return out
      })

  return { members, addMember, updateMember, removeMember, membersValid, cleanMembers }
}
