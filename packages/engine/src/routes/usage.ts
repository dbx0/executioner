import { readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import type { Project } from '@exe/project'
import { encodeProjectDir } from './sessions.js'

/**
 * Live usage for a single Claude Code agent session, as the status bar shows
 * it for the current AI: aggregated input/output/cache tokens,
 * the ccusage-style cost from a per-model price table, the current model, the
 * context-window tokens in flight (last turn) against the model's limit, and a
 * rolling 5-hour block. Everything is derived from the session transcript
 * (~/.claude/projects/<encoded root>/<uuid>.jsonl); no network, node fs only.
 *
 * Mounted under the bearer-guarded /api router. Path-traversal guarded: the
 * requested transcript must resolve inside this engagement's projects dir.
 */

// Pricing tables + pure cost helpers live in ./usage-pricing, transcript
// parsing + aggregation in ./usage-compute. Both are re-exported here so this
// module stays the single import point it has always been.
export { normalizeModelForPricing, contextWindowFor, estimateCostUsd } from './usage-pricing.js'
export { computeUsage, type UsageResult } from './usage-compute.js'

import { DEFAULT_CONTEXT_WINDOW } from './usage-pricing.js'
import { computeUsage, type UsageResult } from './usage-compute.js'

function emptyUsage(): UsageResult {
  return {
    model: null,
    turnCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, total: 0 },
    costUsd: null,
    context: { used: 0, limit: DEFAULT_CONTEXT_WINDOW, percent: 0 },
    block: null,
  }
}

export function usageRoutes(project: Project): Hono {
  const app = new Hono()
  const dir = path.resolve(
    path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(project.root)),
  )

  /** The most-recently-modified transcript in the engagement's projects dir. */
  const latestTranscript = (): string | undefined => {
    let best = -1
    let latest: string | undefined
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const p = path.join(dir, f)
        const m = statSync(p).mtimeMs
        if (m > best) {
          best = m
          latest = p
        }
      }
    } catch {
      /* no projects dir yet */
    }
    return latest
  }

  app.get('/usage', (c) => {
    const session = c.req.query('session')

    let abs: string
    if (session !== undefined && session !== '') {
      // Path-traversal guard: the transcript filename (session id) must resolve
      // strictly inside this engagement's projects dir. Reject separators/traversal.
      abs = path.resolve(path.join(dir, `${session}.jsonl`))
      const withinDir = abs === dir || abs.startsWith(dir + path.sep)
      if (!withinDir || path.dirname(abs) !== dir) {
        return c.json({ error: 'invalid session' }, 400)
      }
    } else {
      // No session id (the resume id isn't known yet, or the active tab isn't the
      // agent): fall back to the engagement's most recent transcript so the bar
      // still reflects the current AI's usage.
      const latest = latestTranscript()
      if (latest === undefined) return c.json(emptyUsage())
      abs = latest
    }

    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      // No transcript yet (agent just started, or an older engine): empty state.
      return c.json(emptyUsage())
    }
    return c.json(computeUsage(text))
  })

  return app
}
