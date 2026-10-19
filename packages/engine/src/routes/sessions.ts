import { readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import type { Project } from '@exe/project'

/**
 * Lists the Claude Code transcripts recorded for this engagement. Claude Code
 * stores them at ~/.claude/projects/<encoded>/*.jsonl, where <encoded> is the
 * project root with every non-alphanumeric character replaced by '-'. Mounted
 * under the bearer-guarded /api router; degrades to an empty list when the
 * transcript directory is missing or unreadable.
 */

/** Encode an absolute project root the way Claude Code names its transcript dir. */
export function encodeProjectDir(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Pull the first human prompt and the user/assistant message count out of a
 * raw .jsonl transcript. The first prompt is the first user entry whose content
 * resolves to a non-empty string that is not a tool/command/meta marker (does
 * not start with '<'); it is whitespace-collapsed and capped at 100 chars.
 */
export function summarizeTranscript(text: string): {
  firstPrompt: string | null
  messageCount: number
} {
  let firstPrompt: string | null = null
  let messageCount = 0

  for (const line of text.split('\n')) {
    if (line === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { type?: unknown; message?: unknown }
    if (record.type === 'user' || record.type === 'assistant') messageCount++

    if (firstPrompt === null && record.type === 'user') {
      const content = resolveContent(record.message)
      if (content !== null) {
        const collapsed = content.trim().replace(/\s+/g, ' ')
        if (collapsed !== '' && !collapsed.startsWith('<')) {
          firstPrompt = collapsed.slice(0, 100)
        }
      }
    }
  }

  return { firstPrompt, messageCount }
}

/** Resolve an entry's message content to a string, or null when there is none. */
function resolveContent(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textPart = content.find(
      (p): p is { type: string; text?: unknown } =>
        typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text',
    )
    if (textPart !== undefined && typeof textPart.text === 'string') return textPart.text
  }
  return null
}

export function sessionRoutes(project: Project): Hono {
  const app = new Hono()
  const dir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(project.root))

  app.get('/sessions', (c) => {
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return c.json({ sessions: [] })
    }

    const sessions = files
      .map((file) => {
        try {
          const abs = path.join(dir, file)
          const stat = statSync(abs)
          const id = file.slice(0, -'.jsonl'.length)
          const text = readFileSync(abs, 'utf8')
          const { firstPrompt, messageCount } = summarizeTranscript(text)
          return {
            id,
            title: firstPrompt ?? id,
            firstPrompt,
            messageCount,
            modifiedAt: stat.mtimeMs,
            sizeBytes: stat.size,
          }
        } catch {
          return null
        }
      })
      .filter(
        (
          s,
        ): s is {
          id: string
          title: string
          firstPrompt: string | null
          messageCount: number
          modifiedAt: number
          sizeBytes: number
        } => s !== null,
      )
      .sort((a, b) => b.modifiedAt - a.modifiedAt)

    return c.json({ sessions })
  })

  return app
}
