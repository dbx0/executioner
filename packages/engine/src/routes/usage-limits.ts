import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

/**
 * Account rate-limit windows for the local AI providers, as the status bar
 * shows them: Claude's rolling 5-hour window, the 7-day weekly window, and
 * the "Fable" weekly-scoped window, each with a percent-used and a reset time.
 *
 * Unlike /usage (which derives token/cost numbers from the session transcript),
 * this route calls Anthropic's OAuth usage endpoint with the user's Claude Code
 * credentials:
 *
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Authorization: Bearer <claudeAiOauth.accessToken>
 *   anthropic-beta: oauth-2025-04-20
 *   User-Agent:     claude-code/2.1.0
 *
 * The bearer token comes from the Claude Code credential store: the macOS Keychain item "Claude Code-credentials" (account =
 * $USER) first on darwin, then ~/.claude/.credentials.json. Both hold a JSON
 * blob with a `claudeAiOauth.accessToken`.
 *
 * Never throws to the client: missing credentials or a failed request degrade to
 * a per-provider `error: 'Refresh failed'` shape (HTTP 200), which the desktop
 * status bar renders as the "Refresh failed" row. node fs + global fetch only.
 */

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const API_TIMEOUT_MS = 10_000
const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const REFRESH_FAILED = 'Refresh failed'

/** A single normalized rate-limit window: percent consumed (0–100) + reset. */
export interface LimitWindow {
  /** Percentage of the window consumed, clamped 0–100 and rounded. */
  percent: number
  /** Unix ms timestamp when the window resets, or null if unknown. */
  resetsAt: number | null
}

/** Per-provider normalized limits. `error` is null on success. */
export interface ProviderLimits {
  provider: 'claude' | 'codex'
  five_hour: LimitWindow | null
  weekly: LimitWindow | null
  fable: LimitWindow | null
  plan: string | null
  error: string | null
}

export interface UsageLimitsResponse {
  claude: ProviderLimits
  codex: ProviderLimits
  updatedAt: number
}

// --- Raw Anthropic OAuth usage payload (only the fields we read). -----------

interface RawUsageWindow {
  utilization?: number
  used_percentage?: number
  resets_at?: string | number
}

interface RawUsageLimit {
  kind?: string
  percent?: number
  resets_at?: string | number
  scope?: { model?: { display_name?: string } | null } | null
}

interface RawUsageResponse {
  five_hour?: RawUsageWindow
  seven_day?: RawUsageWindow
  fable_weekly?: RawUsageWindow
  fable_seven_day?: RawUsageWindow
  seven_day_fable?: RawUsageWindow
  limits?: RawUsageLimit[] | null
  plan?: string | null
  subscription?: { plan?: string | null } | null
}

/**
 * Parse a reset timestamp to Unix ms. Anthropic sends either an ISO string or a
 * numeric epoch; 1e10 sits between any plausible seconds epoch (<2286) and any
 * millisecond epoch (>2001), so it disambiguates seconds vs ms without metadata.
 */
export function parseResetTimestamp(value: string | number | undefined): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (!value) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && value.trim() !== '') {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000
  }
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

/** Normalize one raw window into { percent, resetsAt }, or null if no percent. */
export function normalizeWindow(raw: RawUsageWindow | undefined): LimitWindow | null {
  if (!raw) return null
  const used =
    typeof raw.utilization === 'number'
      ? raw.utilization
      : typeof raw.used_percentage === 'number'
        ? raw.used_percentage
        : null
  if (used === null || !Number.isFinite(used)) return null
  return {
    percent: Math.round(Math.min(100, Math.max(0, used))),
    resetsAt: parseResetTimestamp(raw.resets_at),
  }
}

/**
 * The "Fable" weekly window. Anthropic reports it either as a dedicated
 * `fable_weekly`/`fable_seven_day`/`seven_day_fable` field, or as a
 * `weekly_scoped` entry in `limits[]` whose scope model display name is "fable".
 * Fable is a model/limit tier (Anthropic's internal name for the Opus-class
 * frontier model); its % is a weekly-scoped utilization just like the others.
 */
export function normalizeFable(data: RawUsageResponse): LimitWindow | null {
  const scoped = Array.isArray(data.limits)
    ? data.limits.find(
        (l) =>
          l?.kind === 'weekly_scoped' &&
          typeof l.percent === 'number' &&
          Number.isFinite(l.percent) &&
          l.scope?.model?.display_name?.trim().toLowerCase() === 'fable',
      )
    : undefined
  const scopedWindow: RawUsageWindow | undefined =
    scoped && typeof scoped.percent === 'number'
      ? scoped.resets_at !== undefined
        ? { used_percentage: scoped.percent, resets_at: scoped.resets_at }
        : { used_percentage: scoped.percent }
      : undefined
  return (
    normalizeWindow(scopedWindow) ??
    normalizeWindow(data.fable_weekly) ??
    normalizeWindow(data.fable_seven_day) ??
    normalizeWindow(data.seven_day_fable)
  )
}

/** Turn a raw OAuth usage payload into the normalized Claude provider shape. */
export function normalizeClaudeUsage(data: RawUsageResponse): ProviderLimits {
  const plan =
    (typeof data.plan === 'string' && data.plan.trim() !== '' ? data.plan : null) ??
    (typeof data.subscription?.plan === 'string' && data.subscription.plan.trim() !== ''
      ? data.subscription.plan
      : null)
  return {
    provider: 'claude',
    five_hour: normalizeWindow(data.five_hour),
    weekly: normalizeWindow(data.seven_day),
    fable: normalizeFable(data),
    plan,
    error: null,
  }
}

/** The graceful-failure shape for a provider that could not be refreshed. */
export function providerRefreshFailed(provider: 'claude' | 'codex', message: string = REFRESH_FAILED): ProviderLimits {
  return { provider, five_hour: null, weekly: null, fable: null, plan: null, error: message }
}

/** A human, actionable message for why a Claude usage refresh failed. */
function claudeErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Sign in to Claude Code to see usage.'
  if (status === 429) return 'Rate limited by Anthropic — try again shortly.'
  return `Couldn’t load usage (HTTP ${status}).`
}

// --- Credential reading ---------------------------------------------------

interface ClaudeCredentials {
  claudeAiOauth?: { accessToken?: string }
}

function tokenFromCredentialsJson(raw: string): string | null {
  try {
    const oauth = (JSON.parse(raw) as ClaudeCredentials)?.claudeAiOauth
    return typeof oauth?.accessToken === 'string' && oauth.accessToken !== '' ? oauth.accessToken : null
  } catch {
    return null
  }
}

/** Read the Claude Code OAuth item from the macOS Keychain, or null. */
function readTokenFromKeychain(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  const account = process.env.USER ?? process.env.USERNAME ?? 'user'
  return new Promise((resolve) => {
    try {
      execFile(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
        { timeout: 5_000 },
        (err, stdout) => {
          if (err || typeof stdout !== 'string' || stdout.trim() === '') return resolve(null)
          resolve(tokenFromCredentialsJson(stdout.trim()))
        },
      )
    } catch {
      resolve(null)
    }
  })
}

/** Read the Claude Code OAuth token from ~/.claude/.credentials.json, or null. */
function readTokenFromFile(): string | null {
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json')
    return tokenFromCredentialsJson(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** Resolve a Claude bearer token: keychain first, then file. */
export async function readClaudeToken(): Promise<string | null> {
  const fromKeychain = await readTokenFromKeychain()
  if (fromKeychain !== null) return fromKeychain
  return readTokenFromFile()
}

/**
 * Fetch + normalize Claude account rate limits. Never throws: any failure
 * (missing token, network error, non-2xx, bad JSON) resolves to the
 * `Refresh failed` provider shape.
 */
export async function fetchClaudeLimits(
  readToken: () => Promise<string | null>,
  fetchImpl: typeof fetch,
): Promise<ProviderLimits> {
  try {
    const token = await readToken()
    if (token === null) return providerRefreshFailed('claude', 'Not signed in to Claude Code.')
    const res = await fetchImpl(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.0',
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
    if (!res.ok) return providerRefreshFailed('claude', claudeErrorMessage(res.status))
    const data = (await res.json()) as RawUsageResponse
    return normalizeClaudeUsage(data)
  } catch {
    return providerRefreshFailed('claude', 'Couldn’t reach Anthropic. Check your connection.')
  }
}

export interface UsageLimitsDeps {
  /** Override the token reader (tests). Defaults to the keychain-then-file read. */
  readToken?: () => Promise<string | null>
  /** Override fetch (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** Serve a cached Claude result for this long without re-hitting Anthropic. The
 *  usage endpoint rate-limits (HTTP 429) frequent calls, and several client
 *  pollers (status bar, panel, Agents page) share this one route — so caching
 *  keeps us well under the limit. */
const CACHE_TTL_MS = 120_000

export function usageLimitsRoutes(deps: UsageLimitsDeps = {}): Hono {
  const app = new Hono()
  const readToken = deps.readToken ?? readClaudeToken
  const fetchImpl = deps.fetchImpl ?? fetch
  let cache: { data: ProviderLimits; at: number } | null = null

  app.get('/usage/limits', async (c) => {
    const force = c.req.query('refresh') === '1'
    let claude: ProviderLimits
    if (!force && cache !== null && Date.now() - cache.at < CACHE_TTL_MS) {
      claude = cache.data
    } else {
      const fresh = await fetchClaudeLimits(readToken, fetchImpl)
      if (fresh.error === null) {
        cache = { data: fresh, at: Date.now() }
        claude = fresh
      } else if (cache !== null) {
        // Transient failure (e.g. a 429) — keep showing the last good numbers
        // rather than blanking them, but carry the reason for the client.
        claude = { ...cache.data, error: fresh.error }
      } else {
        claude = fresh
      }
    }
    // We don't integrate Codex OAuth yet, so its row reports an unavailable state.
    const codex = providerRefreshFailed('codex', 'Codex account usage isn’t available yet.')
    const body: UsageLimitsResponse = { claude, codex, updatedAt: Date.now() }
    return c.json(body)
  })

  return app
}
