import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Loader2, RefreshCw, Check, X, Zap } from 'lucide-react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { Button } from '../../components/ui/button.js'
import { agentsApi, type AgentStatus } from '../../api/agents.js'
import { agentMcpApi, isWired, type AgentMcpWiring } from '../../api/agent-mcp.js'
import { Switch } from '../../components/ui/switch.js'
import { usageLimitsApi, type ProviderLimits, type UsageLimits } from '../../api/usage-limits.js'
import { clampPercent, meterFillColor, formatResetCountdown } from '../../app-shell/UsagePanel.js'
import { PageHeading } from './parts.js'

/** The agents the app can launch, rendered immediately (before validation). */
interface AgentInfo {
  id: string
  name: string
  binary: string
  /** The provider key when this agent has account rate-limit usage. */
  usage?: 'claude' | 'codex'
  blurb: string
}
const AGENTS: AgentInfo[] = [
  { id: 'claude', name: 'Claude', binary: 'claude', usage: 'claude', blurb: 'Anthropic Claude Code CLI.' },
  { id: 'codex', name: 'Codex', binary: 'codex', usage: 'codex', blurb: 'OpenAI Codex CLI.' },
  { id: 'opencode', name: 'OpenCode', binary: 'opencode', blurb: 'Open-source coding agent.' },
  { id: 'gemini', name: 'Gemini', binary: 'gemini', blurb: 'Google Gemini CLI.' },
  { id: 'cursor', name: 'Cursor', binary: 'cursor-agent', blurb: 'Cursor agent CLI.' },
  { id: 'hermes', name: 'Hermes', binary: 'hermes', blurb: 'Nous Research Hermes CLI.' },
]

type CardState = 'checking' | 'working' | 'missing'

/** A single labeled usage meter (color-mix fill — tokens are hex). */
function Meter({ label, percent }: { label: string; percent: number }): JSX.Element {
  const width = clampPercent(percent)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="relative block h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${width}%`, backgroundColor: meterFillColor(percent) }}
        />
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {label} {Math.round(percent)}%
      </span>
    </div>
  )
}

/** The account-usage strip inside the Claude/Codex cards. */
function UsageStrip({ p, onRetry, retrying }: { p: ProviderLimits; onRetry: () => void; retrying: boolean }): JSX.Element {
  const now = Date.now()
  const meters = [
    p.five_hour ? { key: '5h', label: '5h', percent: p.five_hour.percent } : null,
    p.weekly ? { key: 'wk', label: 'wk', percent: p.weekly.percent } : null,
    p.fable ? { key: 'fable', label: 'Fable', percent: p.fable.percent } : null,
  ].filter((m): m is { key: string; label: string; percent: number } => m !== null)
  // The engine serves the last-known numbers on a transient failure, so meters
  // may be present even with an error set — show the numbers, note the error.
  const reset = formatResetCountdown(p.five_hour?.resetsAt ?? null, now)

  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Account usage
        {reset !== null && (
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-muted-foreground">
            <Zap className="size-3" /> {reset}
          </span>
        )}
      </div>
      {meters.length > 0 ? (
        <div className="flex items-center gap-3">
          {meters.map((m) => (
            <Meter key={m.key} label={m.label} percent={m.percent} />
          ))}
        </div>
      ) : null}
      {p.error !== null && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{p.error}</span>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            {retrying ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Retry
          </button>
        </div>
      )}
    </div>
  )
}

/** The status badge — one consistent badge whose state is checking/working/missing. */
function StatusBadge({ state }: { state: CardState }): JSX.Element {
  if (state === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Checking
      </span>
    )
  }
  if (state === 'working') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-status-success">
        <Check className="size-3" strokeWidth={2.5} /> Working
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-destructive">
      <X className="size-3" strokeWidth={2.5} /> Not found
    </span>
  )
}

/** The version chip — a SEPARATE badge, shown only when a version is known. */
function VersionChip({ version }: { version: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      {version}
    </span>
  )
}

/** One agent card: brand mark, name, status + version badges, binary, Verify, usage. */
function AgentCard({
  info,
  status,
  state,
  limits,
  onVerify,
  onRetryUsage,
  retryingUsage,
  mcpCapable,
  mcpWired,
  onToggleMcp,
}: {
  info: AgentInfo
  status: AgentStatus | undefined
  state: CardState
  limits: UsageLimits | null
  onVerify: () => void
  onRetryUsage: () => void
  retryingUsage: boolean
  /** True when the engine can inject the project MCP into this agent. */
  mcpCapable: boolean
  /** Whether project-MCP injection is currently on for this agent. */
  mcpWired: boolean
  onToggleMcp: (value: boolean) => void
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
          <AgentIcon agent={info.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{info.name}</span>
            <StatusBadge state={state} />
            {state === 'working' && status?.version != null && <VersionChip version={status.version} />}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{info.blurb}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{info.binary}</span>
            {state === 'missing' && <span className="text-muted-foreground"> — {status?.error ?? 'not on PATH'}</span>}
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" disabled={state === 'checking'} onClick={onVerify}>
          {state === 'checking' ? <Loader2 className="size-3.5 animate-spin" /> : 'Verify'}
        </Button>
      </div>
      {mcpCapable && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-surface-1 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium">Project MCP</div>
            <div className="text-[11px] text-muted-foreground">
              Wire your engagement's tools (targets, findings, workflows) into this agent when it launches here.
            </div>
          </div>
          <Switch
            checked={mcpWired}
            onCheckedChange={onToggleMcp}
            aria-label={`Wire the project MCP into ${info.name}`}
          />
        </div>
      )}
      {info.usage !== undefined && limits !== null && (
        <UsageStrip p={limits[info.usage]} onRetry={onRetryUsage} retrying={retryingUsage} />
      )}
    </div>
  )
}

/**
 * Settings → Agents: every agent renders immediately as its own card; each card's
 * status badge starts "Checking" and updates on its own as the engine validates
 * that agent's CLI (present on PATH + version). Status and version are separate
 * badges. Claude/Codex cards carry a compact account-usage strip.
 */
function AgentsList({ client }: { client: AxiosInstance }): JSX.Element {
  const api = agentsApi(client)
  const usageApi = usageLimitsApi(client)
  const mcpApi = agentMcpApi(client)
  const [results, setResults] = useState<Record<string, AgentStatus>>({})
  const [checking, setChecking] = useState<Set<string>>(() => new Set(AGENTS.map((a) => a.id)))
  const [limits, setLimits] = useState<UsageLimits | null>(null)
  const [retryingUsage, setRetryingUsage] = useState(false)
  const [mcpConfig, setMcpConfig] = useState<AgentMcpWiring>({ enabled: {} })
  const [mcpCapable, setMcpCapable] = useState<Set<string>>(() => new Set())

  // Persist a single agent's MCP wiring toggle, updating local state optimistically.
  const toggleMcp = useCallback(
    (id: string, value: boolean) => {
      setMcpConfig((prev) => {
        const next: AgentMcpWiring = { enabled: { ...prev.enabled, [id]: value } }
        void mcpApi.setConfig(next).catch(() => undefined)
        return next
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  const refreshLimits = useCallback(
    (force: boolean) => {
      if (force) setRetryingUsage(true)
      void usageApi
        .get(force)
        .then(setLimits)
        .catch(() => undefined)
        .finally(() => setRetryingUsage(false))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  const verifyOne = useCallback(
    (id: string) => {
      setChecking((prev) => new Set(prev).add(id))
      void api
        .verify(id)
        .then((updated) => setResults((prev) => ({ ...prev, [id]: updated })))
        .catch(() => undefined)
        .finally(() =>
          setChecking((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          }),
        )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  // Kick a per-agent check on mount (so each badge resolves independently) and
  // fetch usage once.
  useEffect(() => {
    for (const a of AGENTS) verifyOne(a.id)
    refreshLimits(false)
    void mcpApi
      .injectable()
      .then((r) => setMcpCapable(new Set(r.agents)))
      .catch(() => undefined)
    void mcpApi.getConfig().then(setMcpConfig).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const anyChecking = checking.size > 0

  const stateFor = (id: string): CardState => {
    if (checking.has(id)) return 'checking'
    const r = results[id]
    if (r === undefined) return 'checking'
    return r.installed ? 'working' : 'missing'
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <Button variant="outline" size="sm" disabled={anyChecking} onClick={() => AGENTS.forEach((a) => verifyOne(a.id))}>
          {anyChecking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          Verify all
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {AGENTS.map((info) => (
          <AgentCard
            key={info.id}
            info={info}
            status={results[info.id]}
            state={stateFor(info.id)}
            limits={limits}
            onVerify={() => verifyOne(info.id)}
            onRetryUsage={() => refreshLimits(true)}
            retryingUsage={retryingUsage}
            mcpCapable={mcpCapable.has(info.id)}
            mcpWired={isWired(mcpConfig, info.id)}
            onToggleMcp={(value) => toggleMcp(info.id, value)}
          />
        ))}
      </div>
    </>
  )
}

/** Settings sub-page wrapper: heading + the agent cards (needs an engagement). */
export function AgentsSection(): JSX.Element {
  const client = useApp((s) => s.client)
  return (
    <div>
      <PageHeading title="Agents" description="The coding-agent CLIs the app can launch." />
      {client === null ? (
        <p className="text-xs text-muted-foreground">Open an engagement to check agents.</p>
      ) : (
        <AgentsList client={client} />
      )}
    </div>
  )
}
