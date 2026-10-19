import { contextWindowFor, estimateCostUsd } from './usage-pricing.js'

// --- Transcript parsing ---------------------------------------------------

interface ParsedTurn {
  timestamp: string
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  dedupeKey: string | null
}

interface SourceRecord {
  type?: string
  timestamp?: string
  requestId?: string
  uuid?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
    }
  }
}

function dedupeKeyOf(r: SourceRecord): string | null {
  const messageId = r.message?.id?.trim()
  const requestId = r.requestId?.trim()
  if (messageId && requestId) return `${messageId}:${requestId}`
  if (messageId) return `msg:${messageId}`
  const uuid = r.uuid?.trim()
  if (uuid) return `uuid:${uuid}`
  return null
}

function parseTurn(line: string): ParsedTurn | null {
  let r: SourceRecord
  try {
    r = JSON.parse(line) as SourceRecord
  } catch {
    return null
  }
  if (r.type !== 'assistant' || !r.timestamp) return null
  const usage = r.message?.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
  const cacheWrite1hTokens = Math.min(
    usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheWriteTokens,
  )
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) return null
  return {
    timestamp: r.timestamp,
    model: r.message?.model ?? null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWrite1hTokens,
    dedupeKey: dedupeKeyOf(r),
  }
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

export interface UsageResult {
  model: string | null
  turnCount: number
  firstTimestamp: string | null
  lastTimestamp: string | null
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cacheWrite1h: number
    total: number
  }
  costUsd: number | null
  context: { used: number; limit: number; percent: number }
  block: {
    startedAt: number
    endsAt: number
    isActive: boolean
    tokens: number
    costUsd: number | null
  } | null
}

/** Aggregate a raw transcript's assistant turns into usage metrics. */
export function computeUsage(text: string, now: number = Date.now()): UsageResult {
  const turns: ParsedTurn[] = []
  const indexByKey = new Map<string, number>()

  for (const line of text.split('\n')) {
    if (line === '') continue
    const turn = parseTurn(line)
    if (turn === null) continue
    if (turn.dedupeKey !== null) {
      const existingIndex = indexByKey.get(turn.dedupeKey)
      if (existingIndex !== undefined) {
        // Claude Code streams repeated rows for one turn; keep the max per field.
        const existing = turns[existingIndex]!
        existing.inputTokens = Math.max(existing.inputTokens, turn.inputTokens)
        existing.outputTokens = Math.max(existing.outputTokens, turn.outputTokens)
        existing.cacheReadTokens = Math.max(existing.cacheReadTokens, turn.cacheReadTokens)
        existing.cacheWriteTokens = Math.max(existing.cacheWriteTokens, turn.cacheWriteTokens)
        existing.cacheWrite1hTokens = Math.max(existing.cacheWrite1hTokens, turn.cacheWrite1hTokens)
        if (turn.model !== null) existing.model = turn.model
        continue
      }
      indexByKey.set(turn.dedupeKey, turns.length)
    }
    turns.push(turn)
  }

  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cacheWrite1h = 0
  let lastModel: string | null = null
  let last: ParsedTurn | null = null
  for (const t of turns) {
    input += t.inputTokens
    output += t.outputTokens
    cacheRead += t.cacheReadTokens
    cacheWrite += t.cacheWriteTokens
    cacheWrite1h += t.cacheWrite1hTokens
    if (t.model !== null) lastModel = t.model
    last = t
  }

  const costUsd = estimateCostUsd(lastModel, input, output, cacheRead, cacheWrite, cacheWrite1h)

  // Context in flight = the last turn's full prompt (input + both cache pools).
  const limit = contextWindowFor(lastModel)
  const contextUsed =
    last === null ? 0 : last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens
  const percent = limit > 0 ? Math.min(100, (contextUsed / limit) * 100) : 0

  return {
    model: lastModel,
    turnCount: turns.length,
    firstTimestamp: turns[0]?.timestamp ?? null,
    lastTimestamp: last?.timestamp ?? null,
    tokens: {
      input,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite1h,
      total: input + output + cacheRead + cacheWrite,
    },
    costUsd,
    context: { used: contextUsed, limit, percent },
    block: computeCurrentBlock(turns, lastModel, now),
  }
}

/**
 * Rolling 5-hour block (ccusage-style): walk turns in time order, opening a new
 * block whenever 5h have elapsed since the block's floored-to-hour start or
 * since the previous turn. Return only the most recent block — the one the
 * status bar shows — with its tokens/cost and whether it is still open.
 */
function computeCurrentBlock(
  turns: ParsedTurn[],
  model: string | null,
  now: number,
): UsageResult['block'] {
  const dated = turns
    .map((t) => ({ t, ms: Date.parse(t.timestamp) }))
    .filter((e): e is { t: ParsedTurn; ms: number } => Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms)
  if (dated.length === 0) return null

  let blockStart = Math.floor(dated[0]!.ms / (60 * 60 * 1000)) * (60 * 60 * 1000)
  let prevMs = dated[0]!.ms
  let cur: ParsedTurn[] = []
  for (const { t, ms } of dated) {
    if (ms - blockStart >= FIVE_HOURS_MS || ms - prevMs >= FIVE_HOURS_MS) {
      blockStart = Math.floor(ms / (60 * 60 * 1000)) * (60 * 60 * 1000)
      cur = []
    }
    cur.push(t)
    prevMs = ms
  }

  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cacheWrite1h = 0
  for (const t of cur) {
    input += t.inputTokens
    output += t.outputTokens
    cacheRead += t.cacheReadTokens
    cacheWrite += t.cacheWriteTokens
    cacheWrite1h += t.cacheWrite1hTokens
  }
  const endsAt = blockStart + FIVE_HOURS_MS
  return {
    startedAt: blockStart,
    endsAt,
    isActive: now < endsAt && now - prevMs < FIVE_HOURS_MS,
    tokens: input + output + cacheRead + cacheWrite,
    costUsd: estimateCostUsd(model, input, output, cacheRead, cacheWrite, cacheWrite1h),
  }
}
