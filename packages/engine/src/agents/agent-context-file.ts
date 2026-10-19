import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Context delivery for agents that have no per-launch system-prompt flag and
 * instead read a markdown context file from their working directory. codex and
 * cursor read `AGENTS.md`; gemini reads `GEMINI.md`; hermes also reads
 * `AGENTS.md`. claude (`--append-system-prompt`) and opencode (its `instructions`
 * config) deliver context another way, so they map to `undefined` here.
 */
const CONTEXT_FILE: Record<string, string> = {
  codex: 'AGENTS.md',
  cursor: 'AGENTS.md',
  hermes: 'AGENTS.md',
  gemini: 'GEMINI.md',
}

/** The working-directory context file `agent` reads, or undefined if it has none. */
export function contextFileForAgent(agent: string): string | undefined {
  return CONTEXT_FILE[agent]
}

const START = '<!-- executioner:briefing:start -->'
const END = '<!-- executioner:briefing:end -->'

/**
 * Write the engagement briefing into `<cwd>/<filename>` as a managed block
 * between markers, replacing only our own block and leaving the rest of the file
 * — the user's own notes and any other tool's managed block (e.g. skills) —
 * untouched. Returns the file path. Mirrors the skills AGENTS.md approach so the
 * two coexist in one file.
 */
export function writeBriefingContextBlock(cwd: string, filename: string, briefing: string): string {
  const path = join(cwd, filename)
  const managed = `${START}\n${briefing}\n${END}`
  let next: string
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8')
    const start = current.indexOf(START)
    const end = current.indexOf(END)
    if (start !== -1 && end !== -1 && end > start) {
      next = current.slice(0, start) + managed + current.slice(end + END.length)
    } else {
      next = `${current.replace(/\s*$/, '')}\n\n${managed}\n`
    }
  } else {
    next = `${managed}\n`
  }
  writeFileSync(path, next, 'utf8')
  return path
}
