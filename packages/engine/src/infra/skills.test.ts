import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverSkills,
  legacySkillsConfigPath,
  skillsConfigPath,
  generateAgentsMd,
  normalizeSkillsConfig,
  parseSkillMd,
  readSkillsConfig,
  writeSkillsConfig,
} from './skills.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-skills-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeSkill(dir: string, frontmatter: string, body = ''): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `${frontmatter}${body}`)
}

describe('parseSkillMd', () => {
  it('reads a YAML block-scalar description', () => {
    const md = ['---', 'name: foo', 'description: |', '  First line of the skill.', '  Second line.', '---', '# Foo'].join('\n')
    const r = parseSkillMd(md)
    expect(r.name).toBe('foo')
    expect(r.description).toBe('First line of the skill. Second line.')
  })

  it('extracts name and description from frontmatter', () => {
    const parsed = parseSkillMd('---\nname: foo\ndescription: Use when doing foo.\n---\n\n# Foo\n')
    expect(parsed).toEqual({ name: 'foo', description: 'Use when doing foo.' })
  })

  it('strips surrounding quotes', () => {
    const parsed = parseSkillMd('---\nname: "bar"\ndescription: \'quoted desc\'\n---\n')
    expect(parsed.name).toBe('bar')
    expect(parsed.description).toBe('quoted desc')
  })

  it('falls back to the first non-heading body line for description', () => {
    const parsed = parseSkillMd('---\nname: baz\n---\n\n# Heading\n\nThis is the intro line.\n')
    expect(parsed.name).toBe('baz')
    expect(parsed.description).toBe('This is the intro line.')
  })

  it('returns nulls when nothing is present', () => {
    expect(parseSkillMd('')).toEqual({ name: null, description: null })
  })
})

describe('discoverSkills', () => {
  it('returns [] for a null or missing folder', () => {
    expect(discoverSkills(null)).toEqual([])
    expect(discoverSkills(join(root, 'nope'))).toEqual([])
  })

  it('finds top-level and nested-one-level skills', () => {
    writeSkill(join(root, 'alpha'), '---\nname: alpha\ndescription: Alpha skill.\n---\n')
    writeSkill(join(root, 'group', 'beta'), '---\nname: beta\ndescription: Beta skill.\n---\n')
    const skills = discoverSkills(root)
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]))
    expect(Object.keys(byName).sort()).toEqual(['alpha', 'beta'])
    expect(byName.alpha!.path).toBe(join(root, 'alpha'))
    expect(byName.beta!.description).toBe('Beta skill.')
  })

  it('falls back to the directory basename when name is absent', () => {
    writeSkill(join(root, 'my-skill'), '---\ndescription: No name here.\n---\n')
    const skills = discoverSkills(root)
    expect(skills[0]?.name).toBe('my-skill')
  })

  it('caps the number scanned', () => {
    for (let i = 0; i < 5; i++) writeSkill(join(root, `s${i}`), `---\nname: s${i}\n---\n`)
    expect(discoverSkills(root, { cap: 3 })).toHaveLength(3)
  })
})

describe('skills config', () => {
  const suiteHome = process.env.EXECUTIONER_HOME
  let home: string

  // Each case gets its own user-level directory: the config is global now, so
  // one test's write would otherwise be the next one's starting state.
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'exe-skillhome-'))
    process.env.EXECUTIONER_HOME = home
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    process.env.EXECUTIONER_HOME = suiteHome
  })

  it('defaults when no file exists', () => {
    expect(readSkillsConfig(root)).toEqual({ folder: null, enabled: {} })
  })

  it('writes to the user-level directory, not the engagement', () => {
    writeSkillsConfig({ folder: '/tmp/skills', enabled: { claude: true, codex: false } })
    expect(skillsConfigPath()).toBe(join(home, 'skills.json'))
    expect(readSkillsConfig(root)).toEqual({ folder: '/tmp/skills', enabled: { claude: true, codex: false } })
  })

  it('serves the same config to every engagement', () => {
    writeSkillsConfig({ folder: '/tmp/skills', enabled: { claude: true } })
    const other = mkdtempSync(join(tmpdir(), 'exe-other-'))
    expect(readSkillsConfig(other)).toEqual({ folder: '/tmp/skills', enabled: { claude: true } })
    rmSync(other, { recursive: true, force: true })
  })

  it('adopts an engagement-local config left by an older build', () => {
    const legacy = legacySkillsConfigPath(root)
    mkdirSync(join(root, '.executioner'), { recursive: true })
    writeFileSync(legacy, JSON.stringify({ folder: '/tmp/legacy', enabled: { claude: true } }))

    expect(readSkillsConfig(root)).toEqual({ folder: '/tmp/legacy', enabled: { claude: true } })
    // Adopted for good: it is the global config from here on, for every engagement.
    expect(JSON.parse(readFileSync(skillsConfigPath(), 'utf8'))).toEqual({
      folder: '/tmp/legacy',
      enabled: { claude: true },
    })
  })

  it('prefers the global config over an engagement-local leftover', () => {
    mkdirSync(join(root, '.executioner'), { recursive: true })
    writeFileSync(legacySkillsConfigPath(root), JSON.stringify({ folder: '/tmp/legacy', enabled: {} }))
    writeSkillsConfig({ folder: '/tmp/global', enabled: {} })
    expect(readSkillsConfig(root).folder).toBe('/tmp/global')
  })

  it('normalizes junk input', () => {
    expect(normalizeSkillsConfig({ folder: 42, enabled: { claude: 'yes', hermes: true } })).toEqual({
      folder: null,
      enabled: { hermes: true },
    })
  })
})

describe('generateAgentsMd', () => {
  const skills = [
    { name: 'alpha', description: 'Alpha skill.', path: '/skills/alpha' },
    { name: 'beta', description: 'Beta skill.', path: '/skills/beta' },
  ]

  it('creates AGENTS.md when absent', () => {
    const res = generateAgentsMd(root, skills)
    expect(res).toEqual({ ok: true, path: join(root, 'AGENTS.md'), count: 2 })
    const md = readFileSync(res.path, 'utf8')
    expect(md).toContain('<!-- executioner:skills:start -->')
    expect(md).toContain('## alpha')
    expect(md).toContain('Skill: /skills/alpha/SKILL.md')
  })

  it('replaces only the managed block and preserves hand-written content', () => {
    const path = join(root, 'AGENTS.md')
    writeFileSync(
      path,
      'My own notes.\n\n<!-- executioner:skills:start -->\nOLD\n<!-- executioner:skills:end -->\n\nMore notes.\n',
    )
    generateAgentsMd(root, [skills[0]!])
    const md = readFileSync(path, 'utf8')
    expect(md).toContain('My own notes.')
    expect(md).toContain('More notes.')
    expect(md).toContain('## alpha')
    expect(md).not.toContain('OLD')
    expect(md).not.toContain('## beta')
  })
})
