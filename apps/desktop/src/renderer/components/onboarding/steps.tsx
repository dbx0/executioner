import type { JSX } from 'react'
import { Container, Monitor, Server } from 'lucide-react'
import type { ExecutionMode } from '../../store.js'
import { THEMES, type ThemeDef } from '../../lib/themes.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Spinner } from '../ui/spinner.js'
import { ChoiceCard, IconWell, SelectedMark, TileText } from './parts.js'

/** The agent CLIs offered on the first onboarding step (probed for availability). */
const AGENTS: { id: string; name: string; blurb: string }[] = [
  { id: 'claude', name: 'Claude', blurb: 'Anthropic Claude Code CLI.' },
  { id: 'codex', name: 'Codex', blurb: 'OpenAI Codex CLI.' },
  { id: 'opencode', name: 'OpenCode', blurb: 'Open-source coding agent.' },
  { id: 'gemini', name: 'Gemini', blurb: 'Google Gemini CLI.' },
  { id: 'cursor', name: 'Cursor', blurb: 'Cursor agent CLI.' },
  { id: 'hermes', name: 'Hermes', blurb: 'Nous Research Hermes CLI.' },
]

const EXECS: { id: ExecutionMode; name: string; blurb: string; icon: typeof Monitor }[] = [
  { id: 'local', name: 'Local', blurb: 'Run agents and tools on this machine.', icon: Monitor },
  { id: 'ssh', name: 'SSH', blurb: 'Run on a remote host over SSH.', icon: Server },
  { id: 'docker', name: 'Docker', blurb: 'Run inside a Docker container.', icon: Container },
]

const GRID = 'grid grid-cols-2 gap-2.5 sm:grid-cols-3'

/** Pick the default agent. Only a CLI the probe found installed can be chosen. */
export function AgentStep({
  availability,
  value,
  onChange,
}: {
  /** Installed state per agent id; null while the probe is still running. */
  availability: Record<string, boolean> | null
  value: string | null
  onChange: (id: string) => void
}): JSX.Element {
  const checking = availability === null
  return (
    <div className={GRID}>
      {AGENTS.map((a) => {
        const installed = availability?.[a.id] === true
        const selected = value === a.id && installed
        return (
          <ChoiceCard
            key={a.id}
            selected={selected}
            disabled={!installed && !checking}
            onSelect={() => installed && onChange(a.id)}
            className="flex flex-col gap-1.5 p-3"
          >
            <div className="flex items-center gap-2">
              <AgentIcon agent={a.id} className="size-5" />
              <span className="text-[13px] font-medium">{a.name}</span>
              {selected && <SelectedMark className="ml-auto" />}
            </div>
            <span className="text-[11px] text-muted-foreground">{a.blurb}</span>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              {checking && <Spinner size="xs" />}
              {checking ? 'Checking…' : installed ? 'Installed' : 'Not installed'}
            </span>
          </ChoiceCard>
        )
      })}
    </div>
  )
}

/** Pick the theme. Each tile previews the theme's own ground and ink. */
export function ThemeStep({ value, onChange }: { value: string; onChange: (id: ThemeDef['id']) => void }): JSX.Element {
  return (
    <div className={GRID}>
      {THEMES.map((t) => {
        const selected = value === t.id
        return (
          <ChoiceCard key={t.id} selected={selected} onSelect={() => onChange(t.id)} className="flex flex-col gap-2 p-2.5">
            {/* The swatch colors are the theme's data, not app tokens, so they are set inline. */}
            <div
              className="relative h-14 w-full overflow-hidden rounded-[9px] border border-glass-border"
              style={{ background: t.swatch.bg }}
            >
              <span className="absolute left-2 top-2 h-2.5 w-10 rounded-full opacity-90" style={{ background: t.swatch.fg }} />
              <span className="absolute left-2 top-6 h-2 w-7 rounded-full opacity-50" style={{ background: t.swatch.fg }} />
              {selected && <SelectedMark className="absolute right-1.5 top-1.5" />}
            </div>
            <div>
              <div className="text-[13px] font-medium">{t.label}</div>
              <div className="text-[11px] text-muted-foreground">{t.description}</div>
            </div>
          </ChoiceCard>
        )
      })}
    </div>
  )
}

/** Pick where work runs by default. SSH and Docker add the connection steps. */
export function ExecStep({ value, onChange }: { value: ExecutionMode; onChange: (id: ExecutionMode) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {EXECS.map((e) => {
        const selected = value === e.id
        return (
          <ChoiceCard key={e.id} selected={selected} onSelect={() => onChange(e.id)} className="flex items-center gap-3 p-3">
            <IconWell icon={e.icon} />
            <TileText title={e.name} blurb={e.blurb} />
            {selected && <SelectedMark />}
          </ChoiceCard>
        )
      })}
    </div>
  )
}
