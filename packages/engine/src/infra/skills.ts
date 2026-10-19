import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { globalLayout } from '@exe/protocol'

/**
 * Agent Skills support. A "skill" is a directory holding a `SKILL.md` whose YAML
 * frontmatter carries `name:` and `description:`. A "skills folder" holds one or
 * more such skill dirs (possibly nested a level deep). This module discovers and
 * parses skills, persists the USER-level config, and prepares the two things the
 * spawn path needs: a wrapped Claude plugin dir (`--plugin-dir`) and the
 * generated portable `AGENTS.md`.
 *
 * The config is global — your skills folder is your skills folder, in every
 * engagement — while the generated `AGENTS.md` stays per engagement, since that
 * is the file an agent reads from its working directory.
 */

/** The persisted config at `~/.executioner/skills.json`. */
export interface SkillsConfig {
  folder: string | null
  enabled: Record<string, boolean>
}

/** A discovered + parsed skill. `path` is the skill directory. */
export interface Skill {
  name: string
  description: string
  path: string
}

const CONFIG_REL = join('.executioner', 'skills.json')

/** Where skills.json lives: the user-level directory, shared by every engagement. */
export function skillsConfigPath(): string {
  return globalLayout.skillsConfig()
}

/** Where an older build kept it: inside the engagement folder. */
export function legacySkillsConfigPath(root: string): string {
  return join(root, CONFIG_REL)
}

const DEFAULT_CONFIG: SkillsConfig = { folder: null, enabled: {} }

/** Validate/normalize an arbitrary parsed value into a SkillsConfig. */
export function normalizeSkillsConfig(value: unknown): SkillsConfig {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_CONFIG }
  const raw = value as Record<string, unknown>
  const folder = typeof raw.folder === 'string' && raw.folder !== '' ? raw.folder : null
  const enabled: Record<string, boolean> = {}
  if (typeof raw.enabled === 'object' && raw.enabled !== null) {
    for (const [k, v] of Object.entries(raw.enabled as Record<string, unknown>)) {
      if (typeof v === 'boolean') enabled[k] = v
    }
  }
  return { folder, enabled }
}

/** Read one skills.json, or undefined when it is absent or unreadable. */
function readConfigFile(path: string): SkillsConfig | undefined {
  try {
    if (!existsSync(path)) return undefined
    return normalizeSkillsConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return undefined
  }
}

/**
 * Read the user-level skills.json, defaulting on any problem. When `root` is
 * given and nothing is configured globally yet, an engagement-local config
 * written by an older build is adopted once, so an upgrade keeps the skills
 * folder the user already chose.
 */
export function readSkillsConfig(root?: string): SkillsConfig {
  const global = readConfigFile(skillsConfigPath())
  if (global !== undefined) return global
  if (root !== undefined) {
    const legacy = readConfigFile(legacySkillsConfigPath(root))
    if (legacy !== undefined) return writeSkillsConfig(legacy)
  }
  return { ...DEFAULT_CONFIG }
}

/** Write the user-level skills.json (creating the directory if needed). */
export function writeSkillsConfig(config: SkillsConfig): SkillsConfig {
  const normalized = normalizeSkillsConfig(config)
  const path = skillsConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

/**
 * Extract `{ name, description }` from a SKILL.md string. Parses the leading
 * `--- … ---` YAML frontmatter for `name:`/`description:`; either may be null
 * when absent. The description falls back (when the frontmatter lacks one) to
 * the first non-frontmatter, non-heading, non-empty body line.
 */
export function parseSkillMd(content: string): { name: string | null; description: string | null } {
  const text = content.replace(/\r\n/g, '\n')
  let name: string | null = null
  let description: string | null = null
  let body = text

  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fm !== null) {
    body = text.slice(fm[0].length)
    const fmLines = (fm[1] ?? '').split('\n')
    for (let i = 0; i < fmLines.length; i += 1) {
      const m = fmLines[i]!.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
      if (m === null) continue
      const key = m[1]!.toLowerCase()
      let value = (m[2] ?? '').trim()

      // YAML block scalar (`description: |` or `>`, with optional chomping): the
      // value is the following more-indented lines. Fold to one line for display.
      if (/^[|>][+-]?\d*$/.test(value)) {
        const collected: string[] = []
        const baseIndent = fmLines[i + 1]?.match(/^(\s+)\S/)?.[1]?.length ?? 0
        let j = i + 1
        for (; j < fmLines.length && baseIndent > 0; j += 1) {
          const l = fmLines[j]!
          if (l.trim() === '') {
            collected.push('')
            continue
          }
          if ((l.match(/^(\s*)/)?.[1]?.length ?? 0) < baseIndent) break
          collected.push(l.slice(baseIndent))
        }
        i = Math.max(i, j - 1)
        value = collected.join(' ').replace(/\s+/g, ' ').trim()
      } else {
        value = stripQuotes(value)
      }

      if (key === 'name' && value !== '') name = value
      else if (key === 'description' && value !== '') description = value
    }
  }

  if (description === null) {
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      description = trimmed
      break
    }
  }

  return { name, description }
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Discover and parse the skills in a folder. Walks for `SKILL.md` files up to
 * `maxDepth` (default 2) below the folder; each skill's `path` is the directory
 * holding its SKILL.md. Tolerates a missing/malformed folder (→ `[]`) and caps
 * the number scanned so a huge folder can't hang.
 */
export function discoverSkills(folder: string | null, options: { cap?: number; maxDepth?: number } = {}): Skill[] {
  const cap = options.cap ?? 500
  // Skill collections nest by category (e.g. skills/<cat>/<sub>/<skill>/SKILL.md),
  // so walk several levels deep; the cap + dot-dir skip bound the traversal.
  const maxDepth = options.maxDepth ?? 6
  if (folder === null || folder === '') return []
  const out: Skill[] = []

  const walk = (dir: string, depth: number): void => {
    if (out.length >= cap || depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // A SKILL.md right here makes THIS dir a skill.
    const skillFile = join(dir, 'SKILL.md')
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      try {
        const parsed = parseSkillMd(readFileSync(skillFile, 'utf8'))
        out.push({
          name: parsed.name ?? basename(dir),
          description: parsed.description ?? '',
          path: dir,
        })
      } catch {
        /* skip an unreadable SKILL.md */
      }
      if (out.length >= cap) return
    }
    // Recurse into subdirectories (nested skills a level deep).
    for (const e of entries) {
      if (out.length >= cap) return
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
    }
  }

  try {
    walk(folder, 0)
  } catch {
    return out
  }
  return out
}

const AGENTS_START = '<!-- executioner:skills:start -->'
const AGENTS_END = '<!-- executioner:skills:end -->'

/** Build the managed AGENTS.md block (between the start/end markers, exclusive). */
export function buildAgentsMdBlock(skills: Skill[]): string {
  const header =
    'You have the following Agent Skills available. When a task matches one, read that ' +
    "skill's SKILL.md at the path given below and follow it."
  const sections = skills.map((s) => {
    const desc = s.description !== '' ? `${s.description}\n\n` : ''
    return `## ${s.name}\n\n${desc}Skill: ${join(s.path, 'SKILL.md')}`
  })
  return [header, ...sections].join('\n\n')
}

/**
 * Generate/refresh `<root>/AGENTS.md` from the discovered skills. Replaces only
 * the managed block between the start/end markers so hand-written content is
 * preserved; creates the file (with just the managed block) when absent.
 */
export function generateAgentsMd(root: string, skills: Skill[]): { ok: boolean; path: string; count: number } {
  const path = join(root, 'AGENTS.md')
  const managed = `${AGENTS_START}\n${buildAgentsMdBlock(skills)}\n${AGENTS_END}`
  let next: string
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8')
    const start = current.indexOf(AGENTS_START)
    const end = current.indexOf(AGENTS_END)
    if (start !== -1 && end !== -1 && end > start) {
      next = current.slice(0, start) + managed + current.slice(end + AGENTS_END.length)
    } else {
      next = `${current.replace(/\s*$/, '')}\n\n${managed}\n`
    }
  } else {
    next = `${managed}\n`
  }
  writeFileSync(path, next, 'utf8')
  return { ok: true, path, count: skills.length }
}

/**
 * Wrap a user's skills folder in a minimal Claude plugin so it can be passed via
 * `--plugin-dir`. Creates a temp dir with `.claude-plugin/plugin.json` and a
 * `skills/` entry (symlink, falling back to a copy) pointing at the user's
 * folder, so `<temp>/skills/<skill>/SKILL.md` resolves. Returns the temp plugin
 * dir, or null on any failure (the caller then skips the flag).
 */
export function writeClaudeSkillsPlugin(folder: string): string | null {
  try {
    if (!existsSync(folder)) return null
    const dir = mkdtempSync(join(tmpdir(), 'exe-skills-'))
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'executioner-skills', version: '0.0.0', description: 'Executioner user skills' }, null, 2),
    )
    const link = join(dir, 'skills')
    try {
      symlinkSync(folder, link, 'dir')
    } catch {
      // Symlink can fail (e.g. Windows without privilege): fall back to copying.
      mkdirSync(link, { recursive: true })
      copyDirShallow(folder, link)
    }
    return dir
  } catch {
    return null
  }
}

/** Best-effort recursive copy (used only when symlink is unavailable). */
function copyDirShallow(src: string, dest: string): void {
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, e.name)
    const to = join(dest, e.name)
    if (e.isDirectory()) {
      mkdirSync(to, { recursive: true })
      copyDirShallow(from, to)
    } else if (e.isFile()) {
      writeFileSync(to, readFileSync(from))
    }
  }
}
