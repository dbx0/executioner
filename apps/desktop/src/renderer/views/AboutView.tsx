import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderX, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { useApp } from '../store.js'
import { overviewApi, type Overview } from '../api/overview.js'
import { cn } from '../lib/utils.js'
import { friendlyError } from '../lib/api-error.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { IconPicker } from '../components/IconPicker.js'
import { MarkdownRender } from '../components/markdown/MarkdownRender.js'
import { SeverityChip } from './findings/chips.js'
import { ActivityChart, Panel, RankedBars, StackedBar, StatTile } from './about/charts.js'
import {
  agentActivity,
  coverageSlices,
  engagementAge,
  kindSlices,
  relativeSince,
  scopeSlices,
  severitySlices,
  statusSlices,
} from './about/summary.js'

/** Live counts (runs, agents) go stale silently, so the page re-reads slowly. */
const POLL_MS = 15_000

/** How much of the program description stands above the fold. The height is
 *  approximate on purpose: what decides whether the "Show more" control appears
 *  is a measurement of the rendered box, not this number. */
const DESCRIPTION_LINES = 15
const DESCRIPTION_LINE_PX = 24

/**
 * The engagement at a glance: who it is, what has been recorded against it, and
 * where the work has not reached yet.
 *
 * Everything on the page is one `GET /project/overview` read, which is why the
 * numbers on it always agree with each other. The one exception is the agent
 * row: which sessions are working is renderer state, known here and nowhere else.
 */
export function AboutView(): JSX.Element {
  const client = useApp((s) => s.client)
  const sessions = useApp((s) => s.sessions)
  const sessionState = useApp((s) => s.sessionState)
  const subagents = useApp((s) => s.subagents)
  const setActiveView = useApp((s) => s.setActiveView)
  const setPendingTargetId = useApp((s) => s.setPendingTargetId)
  const closeEngagement = useApp((s) => s.closeEngagement)
  const api = useMemo(() => (client === null ? null : overviewApi(client)), [client])

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (api === null) return
    setLoading(true)
    try {
      setData(await api.get())
      setError(null)
    } catch (e) {
      // A 404 here is the engine, not the request: an engagement still served by
      // an older engine has no /project/overview until it restarts.
      setError(friendlyError(e, (e as Error).message))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const agents = agentActivity(sessions, sessionState, subagents)

  const openTarget = (id: string): void => {
    setPendingTargetId(id)
    setActiveView('targets')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <h1 className="text-sm font-medium">About</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="Refresh">
            <RefreshCw className={cn('size-4', loading && 'animate-[spin_1s_linear_infinite]')} strokeWidth={1.75} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => closeEngagement()}
            title="Return to the landing screen. The engine keeps running."
          >
            <FolderX className="size-4" strokeWidth={1.75} />
            Close engagement
          </Button>
        </div>
      </div>

      {error !== null && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-[12px] text-destructive">
          {error}
        </div>
      )}

      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {data === null ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            {error === null ? 'Loading…' : 'Nothing to show while the engine is unreachable.'}
          </p>
        ) : (
          <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3">
            <Identity data={data} agents={agents} />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <StatTile
                label="In scope"
                value={data.targets.byScope.in}
                sub={`of ${data.targets.total} assets`}
                onClick={() => setActiveView('targets')}
              />
              <StatTile
                label="Open findings"
                value={data.findings.byStatus.open ?? 0}
                sub={`${data.findings.total} recorded`}
                onClick={() => setActiveView('findings')}
              />
              <StatTile
                label="Critical + high"
                value={(data.findings.bySeverity.critical ?? 0) + (data.findings.bySeverity.high ?? 0)}
                sub="worth reporting first"
                tone={
                  (data.findings.bySeverity.critical ?? 0) + (data.findings.bySeverity.high ?? 0) > 0
                    ? 'text-status-error'
                    : undefined
                }
                onClick={() => setActiveView('findings')}
              />
              <StatTile
                label="Agents working"
                value={agents.working}
                sub={`${agents.open} open · ${agents.subagents} sub-agents`}
              />
              <StatTile
                label="Runs"
                value={data.runs.running}
                sub={`running of ${data.runs.total}`}
                tone={data.runs.running > 0 ? 'text-status-running' : undefined}
              />
              <StatTile
                label="Recon facts"
                value={data.facts.total}
                sub={`${Object.keys(data.facts.byKind).length} kinds collected`}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Findings by severity" note={`${data.findings.total} total`}>
                <RankedBars slices={severitySlices(data.findings.bySeverity)} empty="Nothing proved yet." />
              </Panel>

              <Panel title="Triage" note={relativeSince(data.findings.lastAt)}>
                <StackedBar slices={statusSlices(data.findings.byStatus)} empty="No findings to triage yet." />
              </Panel>

              <Panel
                title="Scope verdicts"
                note={`${data.scope.includes} include · ${data.scope.excludes} exclude`}
              >
                <StackedBar slices={scopeSlices(data.targets.byScope)} empty="No assets registered yet." />
                {data.scope.rules === 0 && data.targets.total > 0 && (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    No scope rules, so every asset reads as unscoped. Add the boundary on the Scope page.
                  </p>
                )}
              </Panel>

              <Panel title="In-scope coverage" note={`${data.targets.byScope.in} assets`}>
                <StackedBar
                  slices={coverageSlices(data.targets.coverage)}
                  empty="Nothing is in scope yet."
                />
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Untouched assets have no recon facts and no findings against them.
                </p>
              </Panel>

              <Panel title="Assets by kind" note={`last seen ${relativeSince(data.targets.lastSeenAt)}`}>
                <RankedBars slices={kindSlices(data.targets.byKind)} empty="No assets registered yet." />
              </Panel>

              <Panel title="Most-hit assets" note="worst first">
                <TopTargets data={data} onOpen={openTarget} />
              </Panel>

              <Panel title="Last 14 days" className="lg:col-span-2">
                <ActivityChart days={data.activity} />
              </Panel>
            </div>

            <Panel title="Wired up">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
                <Stat label="Workflows" value={data.automation.workflows} />
                <Stat label="Schedules" value={data.automation.schedules} />
                <Stat label="Saved agents" value={data.automation.savedAgents} />
                <Stat label="Scope rules" value={data.scope.rules} />
                <Stat label="Runs succeeded" value={data.runs.succeeded} />
                <Stat label="Runs failed" value={data.runs.failed} />
                <Stat label="Runs cancelled" value={data.runs.cancelled} />
                <Stat label="Last run" value={relativeSince(data.runs.lastAt)} />
              </dl>
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * Name, badge, folder, age, and the program's own description.
 *
 * The badge and the name are edited here rather than in Settings: they belong to
 * the engagement, not to the app, and this is the page that is about it. Both
 * write straight through — an emoji or photo saves on pick, and the name saves on
 * Enter — so there is no second "unsaved" state to explain.
 */
function Identity({
  data,
  agents,
}: {
  data: Overview
  agents: { working: number; open: number; subagents: number }
}): JSX.Element {
  const { engagement } = data
  const updateEngagementMeta = useApp((s) => s.updateEngagementMeta)
  // The store is the live copy: it updates the instant a save lands, while the
  // overview payload only catches up on the next poll.
  const storedName = useApp((s) => s.engagementName)
  const icon = useApp((s) => s.engagementIcon)
  const photo = useApp((s) => s.engagementPhoto)

  const name = storedName ?? engagement.name
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)

  const age = engagementAge(engagement.createdAt)

  const startEditing = (): void => {
    setDraft(name)
    setEditing(true)
  }

  const commit = (): void => {
    const next = draft.trim()
    if (next === '' || next === name) {
      setEditing(false)
      return
    }
    setSaving(true)
    void updateEngagementMeta({ name: next }).finally(() => {
      setSaving(false)
      setEditing(false)
    })
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3.5">
        <IconPicker
          value={{
            ...(icon !== null && icon !== '' ? { icon } : {}),
            ...(photo !== null && photo !== '' ? { photo } : {}),
          }}
          onChange={(next) => void updateEngagementMeta({ icon: next.icon ?? '', photo: next.photo ?? '' })}
          aria-label="Change engagement icon"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                aria-label="Engagement name"
                value={draft}
                disabled={saving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                className="h-8 w-56 text-[15px]"
              />
              <Button size="sm" disabled={saving || draft.trim() === ''} onClick={commit}>
                Save
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-[17px] font-semibold">{name}</h2>
              <Button variant="ghost" size="icon-sm" aria-label="Rename engagement" onClick={startEditing}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
              </Button>
              {agents.working > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--ai)_16%,transparent)] px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ai">
                  <Sparkles className="size-3" strokeWidth={2} />
                  {agents.working} working
                </span>
              )}
            </div>
          )}
          <div className="truncate font-mono text-[11.5px] text-muted-foreground" title={engagement.root}>
            {engagement.root}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11.5px] text-muted-foreground">
          <div>
            Started {age.started} · day {age.day}
          </div>
          <div>
            Last asset {relativeSince(data.targets.lastSeenAt)} · last finding {relativeSince(data.findings.lastAt)}
          </div>
          <div className="uppercase tracking-wide">{engagement.defaultBackend} backend</div>
        </div>
      </div>

      <Description text={engagement.description} />
    </section>
  )
}

/**
 * The program's own words, held to `DESCRIPTION_LINES` until asked. A pasted
 * program brief can run for pages, and the identity card is a header: it should
 * not push the numbers below the fold before anyone has read one.
 */
function Description({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Only the collapsed box is worth measuring: once it is open, scrollHeight and
  // clientHeight agree by definition, so the verdict is kept rather than retaken
  // (which would take the collapse control away with it).
  useEffect(() => {
    if (expanded) return
    const el = ref.current
    if (el === null) return
    const measure = (): void => setClipped(el.scrollHeight - el.clientHeight > 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])

  const empty = text === ''
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div
        ref={ref}
        data-description
        style={expanded ? undefined : { maxHeight: DESCRIPTION_LINES * DESCRIPTION_LINE_PX }}
        className={cn('text-[13px] leading-relaxed', empty && 'text-muted-foreground', !expanded && 'overflow-hidden')}
      >
        {empty ? (
          'No program description yet. It lives under “## Program” in HUNT.md, where the New engagement modal writes it, and you can edit that file directly.'
        ) : (
          // The agent writes this section as Markdown, so it is rendered as
          // Markdown: bullets of rules of engagement should read as bullets.
          <MarkdownRender source={text} className="max-w-none" />
        )}
      </div>
      {(clipped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} strokeWidth={2} />
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/** The assets carrying the most findings: where the engagement actually landed. */
function TopTargets({ data, onOpen }: { data: Overview; onOpen: (id: string) => void }): JSX.Element {
  if (data.findings.topTargets.length === 0) {
    return <p className="py-2 text-[12px] text-muted-foreground">No findings are attached to an asset yet.</p>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {data.findings.topTargets.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
          >
            <SeverityChip severity={t.worst} />
            <span className="truncate font-mono text-[12.5px]">{t.value}</span>
            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {t.findings} {t.findings === 1 ? 'finding' : 'findings'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
