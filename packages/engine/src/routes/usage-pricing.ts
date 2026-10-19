// --- Per-model pricing (USD per 1M tokens) --------------------------------

type ClaudeModelPricing = {
  input: number
  output: number
  cacheRead: number
  /** 5-minute TTL cache write (1.25x base input). */
  cacheWrite: number
  /** 1-hour TTL cache write (2x base input). */
  cacheWrite1h: number
  thresholdTokens?: number
  inputAboveThreshold?: number
  outputAboveThreshold?: number
  cacheReadAboveThreshold?: number
  cacheWriteAboveThreshold?: number
  cacheWrite1hAboveThreshold?: number
}

const LONG_CONTEXT_THRESHOLD_TOKENS = 200_000
const SONNET_LONG_CONTEXT_PRICING = {
  thresholdTokens: LONG_CONTEXT_THRESHOLD_TOKENS,
  inputAboveThreshold: 6,
  outputAboveThreshold: 22.5,
  cacheReadAboveThreshold: 0.6,
  cacheWriteAboveThreshold: 7.5,
  cacheWrite1hAboveThreshold: 12,
} satisfies Partial<ClaudeModelPricing>

const MODEL_PRICING: Record<string, ClaudeModelPricing> = {
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, cacheWrite1h: 20 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, cacheWrite1h: 30 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, cacheWrite1h: 30 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
  'claude-sonnet-4-5': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6,
    ...SONNET_LONG_CONTEXT_PRICING,
  },
  'claude-sonnet-4': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    cacheWrite1h: 6,
    ...SONNET_LONG_CONTEXT_PRICING,
  },
  'claude-sonnet-3-7': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
  'claude-sonnet-3-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1, cacheWrite1h: 1.6 },
  'claude-haiku-3': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3, cacheWrite1h: 0.5 },
}

const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4.8': 'claude-opus-4-8',
  'claude-opus-4.6': 'claude-opus-4-6',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'claude-opus-4.8-thinking': 'claude-opus-4-8',
  'claude-opus-4.6-thinking': 'claude-opus-4-6',
  'claude-sonnet-4.6-thinking': 'claude-sonnet-4-6',
  'claude-opus-4-8-thinking': 'claude-opus-4-8',
  'claude-opus-4-6-thinking': 'claude-opus-4-6',
  'claude-sonnet-4-6-thinking': 'claude-sonnet-4-6',
}

/** Model context window in tokens; default 200k, 1M for the long-context families. */
const CONTEXT_WINDOW: Record<string, number> = {
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5': 1_000_000,
  'claude-sonnet-4': 1_000_000,
}
export const DEFAULT_CONTEXT_WINDOW = 200_000

function hasClaudeModelVersion(model: string, family: string, version: string): boolean {
  const normalized = model.replace(/\./g, '-')
  return new RegExp(`${family}-${version}(?:$|[^0-9])`).test(normalized)
}

function isLegacyBaseOpus4Model(model: string): boolean {
  const normalized = model.replace(/\./g, '-')
  return /opus-4(?:$|-thinking$|-20\d{6}(?:-thinking)?$|@20\d{6}$)/.test(normalized)
}

export function normalizeModelForPricing(model: string | null): string | null {
  if (!model) return null
  const lower = model
    .toLowerCase()
    .trim()
    .replace(/^anthropic[/:]/, '')
  const alias = MODEL_ALIASES[lower]
  if (alias) return alias
  if (hasClaudeModelVersion(lower, 'fable', '5')) return 'claude-fable-5'
  if (hasClaudeModelVersion(lower, 'opus', '5')) return 'claude-opus-5'
  if (hasClaudeModelVersion(lower, 'opus', '4-8')) return 'claude-opus-4-8'
  if (hasClaudeModelVersion(lower, 'opus', '4-7')) return 'claude-opus-4-7'
  if (hasClaudeModelVersion(lower, 'opus', '4-6')) return 'claude-opus-4-6'
  if (hasClaudeModelVersion(lower, 'opus', '4-5')) return 'claude-opus-4-5'
  if (hasClaudeModelVersion(lower, 'opus', '4-1')) return 'claude-opus-4-1'
  if (isLegacyBaseOpus4Model(lower)) return 'claude-opus-4'
  if (lower.includes('opus-4')) return 'claude-opus-4-8'
  if (hasClaudeModelVersion(lower, 'sonnet', '5')) return 'claude-sonnet-5'
  if (hasClaudeModelVersion(lower, 'sonnet', '4-6')) return 'claude-sonnet-4-6'
  if (hasClaudeModelVersion(lower, 'sonnet', '4-5')) return 'claude-sonnet-4-5'
  if (lower.includes('sonnet-4')) return 'claude-sonnet-4-6'
  if (lower.includes('sonnet-3-7') || lower.includes('sonnet-3.7')) return 'claude-sonnet-3-7'
  if (
    lower.includes('sonnet-3-5') ||
    lower.includes('sonnet-3.5') ||
    lower.includes('3-5-sonnet') ||
    lower.includes('3.5-sonnet')
  ) {
    return 'claude-sonnet-3-5'
  }
  if (lower.includes('haiku-4-5')) return 'claude-haiku-4-5'
  if (lower.includes('haiku-3-5') || lower.includes('haiku-3.5')) return 'claude-haiku-3-5'
  if (lower.includes('3-5-haiku') || lower.includes('3.5-haiku')) return 'claude-haiku-3-5'
  if (lower.includes('haiku-3')) return 'claude-haiku-3'
  return null
}

/** Context window (tokens) for a raw model id; falls back to 200k. */
export function contextWindowFor(model: string | null): number {
  const normalized = normalizeModelForPricing(model)
  if (normalized && CONTEXT_WINDOW[normalized] !== undefined) return CONTEXT_WINDOW[normalized]
  return DEFAULT_CONTEXT_WINDOW
}

function calculateTieredCost(
  tokens: number,
  basePrice: number,
  abovePrice?: number,
  threshold?: number,
): number {
  if (threshold === undefined || abovePrice === undefined) return tokens * basePrice
  const belowTokens = Math.min(tokens, threshold)
  const aboveTokens = Math.max(tokens - threshold, 0)
  return belowTokens * basePrice + aboveTokens * abovePrice
}

/**
 * ccusage-style cost in USD.
 * @param cacheWriteTokens every cache write, both TTLs
 * @param cacheWrite1hTokens the 1-hour-TTL subset of `cacheWriteTokens`
 */
export function estimateCostUsd(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  cacheWrite1hTokens = 0,
): number | null {
  const normalized = normalizeModelForPricing(model)
  if (!normalized) return null
  const pricing = MODEL_PRICING[normalized]!
  const write1hTokens = Math.min(Math.max(cacheWrite1hTokens, 0), cacheWriteTokens)
  const write1hShare = cacheWriteTokens > 0 ? write1hTokens / cacheWriteTokens : 0
  const write5mThreshold =
    pricing.thresholdTokens === undefined ? undefined : pricing.thresholdTokens * (1 - write1hShare)
  const write1hThreshold =
    pricing.thresholdTokens === undefined ? undefined : pricing.thresholdTokens * write1hShare
  return (
    (calculateTieredCost(inputTokens, pricing.input, pricing.inputAboveThreshold, pricing.thresholdTokens) +
      calculateTieredCost(
        outputTokens,
        pricing.output,
        pricing.outputAboveThreshold,
        pricing.thresholdTokens,
      ) +
      calculateTieredCost(
        cacheReadTokens,
        pricing.cacheRead,
        pricing.cacheReadAboveThreshold,
        pricing.thresholdTokens,
      ) +
      calculateTieredCost(
        cacheWriteTokens - write1hTokens,
        pricing.cacheWrite,
        pricing.cacheWriteAboveThreshold,
        write5mThreshold,
      ) +
      calculateTieredCost(
        write1hTokens,
        pricing.cacheWrite1h,
        pricing.cacheWrite1hAboveThreshold,
        write1hThreshold,
      )) /
    1_000_000
  )
}
