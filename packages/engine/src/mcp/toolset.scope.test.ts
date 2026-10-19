import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, readProgramDescription, scaffoldEngagement, type Project } from '@exe/project'
import { ProjectToolset } from './toolset.js'
import { TOOL_SCHEMAS } from './schema.js'

let dir: string
let project: Project
let toolset: ProjectToolset

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-toolset-scope-'))
  project = createProject(dir, { name: 'test' })
  toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('add_scope_rule', () => {
  it('records an include rule the agent read from the program scope', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    expect(project.scopeRules.all().map((r) => r.pattern)).toEqual(['*.smartfit.com.br'])
  })

  it('records an exclusion with the reason the program gave', async () => {
    await toolset.call('add_scope_rule', {
      effect: 'exclude',
      pattern: 'smartfit.io',
      note: 'parked by afterTHOUGHT, Inc.',
    })
    const rule = project.scopeRules.all()[0]
    expect(rule?.effect).toBe('exclude')
    expect(rule?.note).toContain('afterTHOUGHT')
  })

  it('attributes the rule to the agent that added it', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: 'smartfit.com' })
    expect(project.scopeRules.all()[0]?.source).toBe('agent')
  })

  it('does not pile up copies when a scope parse runs twice', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    expect(project.scopeRules.all()).toHaveLength(1)
  })

  it('re-judges targets already in the tree', async () => {
    const stray = project.targets.upsert({ kind: 'domain', value: 'smartfit.io', source: 'agent' })
    expect(stray.scopeStatus).toBe('unknown')

    await toolset.call('add_scope_rule', { effect: 'exclude', pattern: 'smartfit.io' })

    expect(project.targets.get(stray.id)?.scopeStatus).toBe('out')
  })

  it('rejects an effect it does not understand', async () => {
    await expect(toolset.call('add_scope_rule', { effect: 'maybe', pattern: 'x.com' })).rejects.toThrow()
  })
})

describe('list_scope_rules', () => {
  it('reports the boundary so an agent can check before it adds an asset', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    const rules = (await toolset.call('list_scope_rules', {})) as { effect: string; pattern: string }[]
    expect(rules).toEqual([expect.objectContaining({ effect: 'include', pattern: '*.smartfit.com.br' })])
  })
})

describe('upsert_target — scope feedback', () => {
  it('tells the agent the asset it just added is in scope', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    const result = (await toolset.call('upsert_target', {
      kind: 'subdomain',
      value: 'app.smartfit.com.br',
    })) as { scopeStatus: string }
    expect(result.scopeStatus).toBe('in')
  })

  it('warns the agent when it has drifted off the engagement', async () => {
    await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.smartfit.com.br' })
    const result = (await toolset.call('upsert_target', {
      kind: 'url',
      value: 'https://qrfo5.appsync-api.us-east-1.amazonaws.com/graphql',
    })) as { scopeStatus: string; scopeReason: string }

    expect(result.scopeStatus).toBe('unknown')
    expect(result.scopeReason).toMatch(/no scope rule matches/i)
  })

  it('refuses a wildcard and says where it belongs instead', async () => {
    await expect(
      toolset.call('upsert_target', { kind: 'domain', value: '*.smartfit.com.br' }),
    ).rejects.toThrow(/scope rule/i)
  })

  it('corrects the kind the agent guessed', async () => {
    const result = (await toolset.call('upsert_target', {
      kind: 'subdomain',
      value: 'smartfit.com.br',
    })) as { kind: string }
    expect(result.kind).toBe('domain')
  })
})

describe('tool schemas', () => {
  it('advertises the scope tools to the agent', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['add_scope_rule', 'list_scope_rules']))
  })
})

describe('set_program_description', () => {
  it('writes the brief into HUNT.md and leaves the rest of the file alone', async () => {
    scaffoldEngagement(dir, { name: 'test', description: 'raw pasted notes' })
    const result = await toolset.call('set_program_description', {
      markdown: 'A web bug bounty.\n\n- No DoS\n- Staging only',
    })

    expect(result).toEqual({ ok: true, path: 'HUNT.md' })
    expect(readProgramDescription(dir)).toBe('A web bug bounty.\n\n- No DoS\n- Staging only')
    const text = readFileSync(join(dir, 'HUNT.md'), 'utf8')
    expect(text).toContain('## Phase 1: Recon')
    expect(text).not.toContain('raw pasted notes')
  })

  it('refuses an empty brief rather than blanking the section', async () => {
    scaffoldEngagement(dir, { name: 'test', description: 'keep me' })
    await expect(toolset.call('set_program_description', { markdown: '' })).rejects.toThrow()
    expect(readProgramDescription(dir)).toBe('keep me')
  })

  it('is offered to the agent with a reformat-only contract', () => {
    const schema = TOOL_SCHEMAS.find((s) => s.name === 'set_program_description')
    expect(schema?.inputSchema).toMatchObject({ required: ['markdown'] })
    expect(schema?.description).toContain('word for word')
  })
})
