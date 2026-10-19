import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code's per-project memory, wired up for an engagement.
 *
 * Claude Code keys a memory directory off the agent's working directory and
 * tells the agent that `MEMORY.md` in it is the index of what it knows. For a
 * fresh engagement that file does not exist, so the agent keeps reaching for a
 * document that was never created — the memory is enabled but empty, and it
 * reads as a missing file rather than an empty one.
 *
 * Seeding the index turns that into a working store: the agent finds an index,
 * appends to it, and the next agent in the same engagement starts with what the
 * last one learned.
 */

/**
 * Claude Code's project-key derivation, mirrored from the CLI: every
 * non-alphanumeric character becomes `-`, and a key longer than the cap is
 * truncated and suffixed with a hash.
 *
 * The hash form is deliberately not reproduced — we cannot compute the CLI's
 * hash, so an over-long root returns undefined and the caller skips seeding
 * rather than writing a wrong directory. The agent still creates its own
 * MEMORY.md in that case, guided by the briefing.
 */
const MAX_KEY_LENGTH = 200

export function projectKeyFor(projectRoot: string): string | undefined {
  const key = projectRoot.replace(/[^a-zA-Z0-9]/g, '-')
  return key.length <= MAX_KEY_LENGTH ? key : undefined
}

/** The memory directory Claude Code will use for an agent working in this root. */
export function memoryDirFor(projectRoot: string, home: string = homedir()): string | undefined {
  const key = projectKeyFor(projectRoot)
  return key === undefined ? undefined : join(home, '.claude', 'projects', key, 'memory')
}

/** The index file's initial contents: a title and the one-line-per-memory shape,
 *  with no invented memories — the agent fills it as it learns things. */
function seedIndex(engagementName: string): string {
  return [
    `# ${engagementName} — engagement memory`,
    '',
    'What has been learned about this engagement, one line per memory:',
    '`- [Title](file.md) — one-line hook`',
    '',
  ].join('\n')
}

export interface MemoryFs {
  existsSync(path: string): boolean
  mkdirSync(path: string, options: { recursive: true }): void
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
}

const nodeFs: MemoryFs = {
  existsSync,
  mkdirSync: (p, o) => {
    mkdirSync(p, o)
  },
  writeFileSync: (p, d, e) => writeFileSync(p, d, e),
}

/**
 * Make sure the engagement's memory directory and its `MEMORY.md` index exist.
 * Returns the directory when memory is usable, else undefined.
 *
 * An existing index is never rewritten — it is the agent's own accumulated
 * record, and clobbering it would lose exactly what this is meant to preserve.
 * Every failure is swallowed: memory is an enhancement, and a read-only home
 * directory must not stop an agent from launching.
 */
export function ensureEngagementMemory(
  projectRoot: string,
  engagementName: string,
  fs: MemoryFs = nodeFs,
  home: string = homedir(),
): string | undefined {
  const dir = memoryDirFor(projectRoot, home)
  if (dir === undefined) return undefined
  try {
    fs.mkdirSync(dir, { recursive: true })
    const index = join(dir, 'MEMORY.md')
    if (!fs.existsSync(index)) fs.writeFileSync(index, seedIndex(engagementName), 'utf8')
    return dir
  } catch {
    return undefined
  }
}
