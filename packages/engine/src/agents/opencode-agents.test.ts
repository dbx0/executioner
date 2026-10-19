import { describe, expect, it } from 'vitest'
import { renderOpencodeAgent, writeOpencodeTeamAgents, type OpencodeAgentsFs } from './opencode-agents.js'

/** In-memory fs shim capturing writes and created dirs. */
function memFs(): OpencodeAgentsFs & { files: Map<string, string>; dirs: string[] } {
  const files = new Map<string, string>()
  const dirs: string[] = []
  return {
    files,
    dirs,
    mkdirSync(path: string): void {
      dirs.push(path)
    },
    writeFileSync(path: string, data: string): void {
      files.set(path, data)
    },
  }
}

describe('renderOpencodeAgent', () => {
  it('emits frontmatter + prompt body, with mode subagent', () => {
    const md = renderOpencodeAgent({ name: 'recon', description: 'enumerate the surface', prompt: 'Do recon.' })
    expect(md).toContain('mode: subagent')
    expect(md).toContain('description: "enumerate the surface"')
    expect(md.trimEnd().endsWith('Do recon.')).toBe(true)
    // No model line when unset.
    expect(md).not.toContain('model:')
  })

  it('emits a model line only for a provider/model id', () => {
    const withModel = renderOpencodeAgent({ name: 'r', description: 'd', prompt: 'p', model: 'anthropic/claude-sonnet-4-5' })
    expect(withModel).toContain('model: "anthropic/claude-sonnet-4-5"')
    // A bare Claude alias (no slash) is not a valid opencode model → dropped.
    const aliasOnly = renderOpencodeAgent({ name: 'r', description: 'd', prompt: 'p', model: 'opus' })
    expect(aliasOnly).not.toContain('model:')
  })

  it('escapes a description containing quotes/colons safely', () => {
    const md = renderOpencodeAgent({ name: 'r', description: 'maps: routes, "auth" flows', prompt: 'p' })
    expect(md).toContain('description: "maps: routes, \\"auth\\" flows"')
  })
})

describe('writeOpencodeTeamAgents', () => {
  it('writes one file per member under .opencode/agent, skipping blanks', () => {
    const fs = memFs()
    const written = writeOpencodeTeamAgents(
      '/proj',
      [
        { name: 'recon', description: 'd', prompt: 'p1' },
        { name: 'reporter', description: 'd', prompt: 'p2' },
        { name: '', description: 'skip', prompt: 'p3' },
        { name: 'blank-prompt', description: 'd', prompt: '   ' },
      ],
      fs,
    )
    expect(written).toEqual(['recon', 'reporter'])
    expect(fs.dirs[0]).toBe('/proj/.opencode/agent')
    expect(fs.files.has('/proj/.opencode/agent/recon.md')).toBe(true)
    expect(fs.files.has('/proj/.opencode/agent/reporter.md')).toBe(true)
    expect(fs.files.size).toBe(2)
  })

  it('normalises a member name into a filesystem-safe file stem', () => {
    const fs = memFs()
    writeOpencodeTeamAgents('/proj', [{ name: 'Web Crawler!', description: 'd', prompt: 'p' }], fs)
    expect(fs.files.has('/proj/.opencode/agent/web-crawler.md')).toBe(true)
  })
})
