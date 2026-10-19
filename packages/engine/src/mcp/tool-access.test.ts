import { describe, expect, it } from 'vitest'
import { PROFILE_TOOLS, TOOL_ACCESS, type AgentProfile } from './toolset.js'
import { TOOL_SCHEMAS } from './schema.js'

describe('tool access classes', () => {
  it('classify exactly the tools the server advertises', () => {
    expect(Object.keys(TOOL_ACCESS).sort()).toEqual(TOOL_SCHEMAS.map((t) => t.name).sort())
  })

  it('mark every tool that starts a process as dangerous', () => {
    expect(TOOL_ACCESS.run_command).toBe('dangerous')
    expect(TOOL_ACCESS.run_workflow).toBe('dangerous')
  })

  it('give an interactive session every tool', () => {
    expect([...PROFILE_TOOLS.interactive].sort()).toEqual(Object.keys(TOOL_ACCESS).sort())
  })

  it.each<AgentProfile>(['workflow', 'assistant', 'scope'])('give the headless %s profile no dangerous tool', (profile) => {
    for (const tool of PROFILE_TOOLS[profile]) expect(TOOL_ACCESS[tool]).not.toBe('dangerous')
    // Every headless agent can still look around the project.
    expect(PROFILE_TOOLS[profile]).toContain('list_targets')
  })

  it('give each headless profile the tool it reports through', () => {
    expect(PROFILE_TOOLS.workflow).toContain('set_node_output')
    expect(PROFILE_TOOLS.assistant).toContain('propose_workflow')
    expect(PROFILE_TOOLS.scope).toEqual(expect.arrayContaining(['upsert_target', 'add_scope_rule', 'set_program_description']))
  })
})
