import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  fetchClaudeLimits,
  normalizeClaudeUsage,
  normalizeFable,
  normalizeWindow,
  parseResetTimestamp,
  usageLimitsRoutes,
  type ProviderLimits,
  type UsageLimitsResponse,
} from './usage-limits.js'

/** A fetch stub that returns a JSON 200 with the given body. */
function jsonFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

const SAMPLE = {
  five_hour: { utilization: 9, resets_at: '2026-01-01T05:00:00.000Z' },
  seven_day: { used_percentage: 49, resets_at: 1_767_312_000 }, // seconds epoch
  limits: [
    {
      kind: 'weekly_scoped',
      percent: 0,
      resets_at: '2026-01-03T00:00:00.000Z',
      scope: { model: { display_name: 'Fable' } },
    },
  ],
  plan: 'max',
}

describe('usage-limits normalization', () => {
  it('parses seconds and millisecond epochs and ISO strings', () => {
    expect(parseResetTimestamp(1_767_312_000)).toBe(1_767_312_000_000) // seconds -> ms
    expect(parseResetTimestamp(1_767_312_000_000)).toBe(1_767_312_000_000) // already ms
    expect(parseResetTimestamp('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(parseResetTimestamp(undefined)).toBeNull()
    expect(parseResetTimestamp('not-a-date')).toBeNull()
  })

  it('clamps and rounds the percent and prefers utilization over used_percentage', () => {
    expect(normalizeWindow({ utilization: 8.6, used_percentage: 50 })?.percent).toBe(9)
    expect(normalizeWindow({ used_percentage: 140 })?.percent).toBe(100)
    expect(normalizeWindow({ used_percentage: -5 })?.percent).toBe(0)
    expect(normalizeWindow({})).toBeNull()
    expect(normalizeWindow(undefined)).toBeNull()
  })

  it('derives Fable from a weekly_scoped limit whose model display name is fable', () => {
    const fable = normalizeFable(SAMPLE)
    expect(fable).toEqual({ percent: 0, resetsAt: Date.parse('2026-01-03T00:00:00.000Z') })
  })

  it('falls back to a fable_weekly field when no scoped limit is present', () => {
    const fable = normalizeFable({ fable_weekly: { used_percentage: 3, resets_at: 1_767_312_000 } })
    expect(fable).toEqual({ percent: 3, resetsAt: 1_767_312_000_000 })
  })

  it('normalizes a full Claude payload into the five_hour / weekly / fable shape', () => {
    const claude = normalizeClaudeUsage(SAMPLE)
    expect(claude.provider).toBe('claude')
    expect(claude.error).toBeNull()
    expect(claude.five_hour).toEqual({ percent: 9, resetsAt: Date.parse('2026-01-01T05:00:00.000Z') })
    expect(claude.weekly).toEqual({ percent: 49, resetsAt: 1_767_312_000_000 })
    expect(claude.fable).toEqual({ percent: 0, resetsAt: Date.parse('2026-01-03T00:00:00.000Z') })
    expect(claude.plan).toBe('max')
  })
})

describe('usage-limits graceful failure', () => {
  it('returns the Refresh failed shape when no token is available', async () => {
    const result = await fetchClaudeLimits(async () => null, jsonFetch(SAMPLE))
    expect(result.error).toBe('Not signed in to Claude Code.')
    expect(result.five_hour).toBeNull()
  })

  it('returns the Refresh failed shape when the request throws', async () => {
    const throwingFetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const result = await fetchClaudeLimits(async () => 'tok', throwingFetch)
    expect(result.error).toBe('Couldn\u2019t reach Anthropic. Check your connection.')
    expect(result.five_hour).toBeNull()
  })

  it('returns the Refresh failed shape on a non-2xx response', async () => {
    const failFetch = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    const result = await fetchClaudeLimits(async () => 'tok', failFetch)
    expect(result.error).toBe('Sign in to Claude Code to see usage.')
  })

  it('sends the exact Anthropic OAuth headers the usage endpoint expects', async () => {
    let captured: Headers | null = null
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      captured = new Headers(init?.headers)
      return new Response(JSON.stringify(SAMPLE), { status: 200 })
    }) as unknown as typeof fetch
    await fetchClaudeLimits(async () => 'secret-token', capturingFetch)
    expect(captured!.get('authorization')).toBe('Bearer secret-token')
    expect(captured!.get('anthropic-beta')).toBe('oauth-2025-04-20')
    expect(captured!.get('user-agent')).toBe('claude-code/2.1.0')
  })
})

describe('usage-limits route', () => {
  it('returns normalized claude limits and a failed codex row', async () => {
    const app = new Hono()
    app.route('/', usageLimitsRoutes({ readToken: async () => 'tok', fetchImpl: jsonFetch(SAMPLE) }))
    const res = await app.request('/usage/limits')
    expect(res.status).toBe(200)
    const body = (await res.json()) as UsageLimitsResponse
    expect(body.claude.five_hour?.percent).toBe(9)
    expect(body.claude.weekly?.percent).toBe(49)
    expect(body.claude.fable?.percent).toBe(0)
    expect(body.codex.error).toBe('Codex account usage isn\u2019t available yet.')
    expect(typeof body.updatedAt).toBe('number')
  })

  it('degrades to a failed claude row without a 500 when credentials are missing', async () => {
    const app = new Hono()
    app.route('/', usageLimitsRoutes({ readToken: async () => null, fetchImpl: jsonFetch(SAMPLE) }))
    const res = await app.request('/usage/limits')
    expect(res.status).toBe(200)
    const body = (await res.json()) as UsageLimitsResponse
    const claude: ProviderLimits = body.claude
    expect(claude.error).toBe('Not signed in to Claude Code.')
    expect(claude.five_hour).toBeNull()
  })
})
