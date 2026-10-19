import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedAgentMember } from '@exe/db'

/**
 * opencode teams.
 *
 * Unlike Claude (which takes an inline `--agents` JSON payload), opencode reads
 * its sub-agents from markdown files on disk: `.opencode/agent/<name>.md` in the
 * working directory, with YAML frontmatter (`description`, `mode`, `model`, …)
 * and the body as the sub-agent's system prompt. A primary agent then delegates
 * to them via the Task tool, matching Claude Agent Teams conceptually.
 *
 * So to run a saved opencode team we materialise its roster into that folder
 * before launching `opencode` in the engagement directory. Model/tool pins are
 * emitted only when set; tool restriction is left to a future pass (opencode's
 * `permission` model doesn't map 1:1 to our Claude-style tool names), so members
 * inherit the lead's tools for now.
 */

/** A double-quoted YAML scalar — a JSON string is a valid YAML flow scalar. */
function yamlString(s: string): string {
  return JSON.stringify(s)
}

/**
 * Render one roster member as an opencode sub-agent markdown file (frontmatter +
 * prompt body). `model` is emitted only when it looks like a `provider/model`
 * id, since opencode requires that qualified form.
 */
export function renderOpencodeAgent(member: SavedAgentMember): string {
  const lines = ['---', `description: ${yamlString(member.description || member.name)}`, 'mode: subagent']
  if (member.model !== undefined && member.model.includes('/')) {
    lines.push(`model: ${yamlString(member.model)}`)
  }
  lines.push('---', '', member.prompt, '')
  return lines.join('\n')
}

/** A filesystem-name-safe form of a member name (the file stem is the agent id). */
function safeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface OpencodeAgentsFs {
  mkdirSync(path: string, options: { recursive: true }): void
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
}

const nodeFs: OpencodeAgentsFs = {
  mkdirSync: (p, o) => {
    mkdirSync(p, o)
  },
  writeFileSync: (p, d, e) => writeFileSync(p, d, e),
}

/**
 * Write a team's roster into `<projectRoot>/.opencode/agent/` so an interactive
 * `opencode` launched there can delegate to them. Returns the agent ids written.
 * Best-effort: a member without a usable name is skipped; the caller guards the
 * whole call so a write failure never blocks the spawn.
 */
export function writeOpencodeTeamAgents(
  projectRoot: string,
  members: readonly SavedAgentMember[],
  fs: OpencodeAgentsFs = nodeFs,
): string[] {
  const dir = join(projectRoot, '.opencode', 'agent')
  fs.mkdirSync(dir, { recursive: true })
  const written: string[] = []
  for (const m of members) {
    const id = safeName(m.name)
    if (id === '' || m.prompt.trim() === '') continue
    fs.writeFileSync(join(dir, `${id}.md`), renderOpencodeAgent(m), 'utf8')
    written.push(id)
  }
  return written
}
