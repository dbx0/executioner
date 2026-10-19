import { describe, expect, it } from 'vitest'
import { ensureEngagementMemory, memoryDirFor, projectKeyFor, type MemoryFs } from './agent-memory.js'

/** In-memory fs shim: path → contents, plus the directories created. */
function memFs(seed: Record<string, string> = {}): MemoryFs & { files: Map<string, string>; dirs: string[] } {
  const files = new Map(Object.entries(seed))
  const dirs: string[] = []
  return {
    files,
    dirs,
    existsSync: (p) => files.has(p),
    mkdirSync: (p) => {
      dirs.push(p)
    },
    writeFileSync: (p, d) => {
      files.set(p, d)
    },
  }
}

const HOME = '/home/tester'

describe('projectKeyFor — Claude Code\'s project key', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    // Mirrors the CLI: path separators and dots alike become dashes.
    expect(projectKeyFor('/home/bx0/Pwning/HACKERONE/SMARTFIT')).toBe('-home-bx0-Pwning-HACKERONE-SMARTFIT')
    expect(projectKeyFor('/home/bx0/Projects/executioner.sh')).toBe('-home-bx0-Projects-executioner-sh')
  })

  it('declines a root past the key length cap rather than guessing', () => {
    // Beyond the cap the CLI appends a hash we cannot reproduce, so seeding
    // would write to the wrong directory. Better to skip and let the agent
    // create its own index.
    expect(projectKeyFor(`/${'a'.repeat(250)}`)).toBeUndefined()
  })
})

describe('memoryDirFor', () => {
  it('resolves the per-engagement memory directory under the Claude config', () => {
    expect(memoryDirFor('/home/bx0/Pwning/HACKERONE/SMARTFIT', HOME)).toBe(
      '/home/tester/.claude/projects/-home-bx0-Pwning-HACKERONE-SMARTFIT/memory',
    )
  })
})

describe('ensureEngagementMemory', () => {
  const DIR = '/home/tester/.claude/projects/-tmp-acme/memory'

  it('creates the directory and seeds an empty index', () => {
    const fs = memFs()
    const dir = ensureEngagementMemory('/tmp/acme', 'Acme Corp', fs, HOME)

    expect(dir).toBe(DIR)
    expect(fs.dirs).toContain(DIR)
    const index = fs.files.get(`${DIR}/MEMORY.md`)!
    expect(index).toContain('# Acme Corp — engagement memory')
    // Seeded as an index, never with invented memories.
    expect(index).not.toMatch(/^- \[/m)
  })

  it('never overwrites an index the agent has already written to', () => {
    const existing = '# Acme Corp — engagement memory\n\n- [Kali box has nuclei](tooling.md) — local does not\n'
    const fs = memFs({ [`${DIR}/MEMORY.md`]: existing })

    ensureEngagementMemory('/tmp/acme', 'Acme Corp', fs, HOME)

    expect(fs.files.get(`${DIR}/MEMORY.md`)).toBe(existing)
  })

  it('reports no memory rather than throwing when the home directory is unwritable', () => {
    const fs: MemoryFs = {
      existsSync: () => false,
      mkdirSync: () => {
        throw new Error('EROFS')
      },
      writeFileSync: () => {
        throw new Error('EROFS')
      },
    }
    expect(ensureEngagementMemory('/tmp/acme', 'Acme', fs, HOME)).toBeUndefined()
  })
})
