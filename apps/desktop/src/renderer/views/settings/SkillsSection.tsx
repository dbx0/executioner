import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { FolderOpen, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { ConfirmModal } from '../../components/modals/ConfirmModal.js'
import { Button } from '../../components/ui/button.js'
import { Switch } from '../../components/ui/switch.js'
import { skillsApi, type Skill, type SkillsConfig } from '../../api/skills.js'
import { PageHeading, GroupLabel } from './parts.js'

/** Agents that take a native skill flag at spawn (toggle only). */
const SKILL_FLAG_AGENTS: Array<{ id: string; name: string }> = [
  { id: 'claude', name: 'Claude' },
  { id: 'hermes', name: 'Hermes' },
]

/** Agents with no spawn flag: enabling offers to generate AGENTS.md. */
const FALLBACK_AGENTS: Array<{ id: string; name: string }> = [
  { id: 'codex', name: 'Codex' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'cursor', name: 'Cursor' },
]

/** One agent activation row: brand mark, name, hint, and a Switch. */
function AgentRow({
  id,
  name,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  id: string
  name: string
  hint: string
  checked: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2">
        <AgentIcon agent={id} className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{name}</div>
        <div className="text-[11.5px] text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onToggle} aria-label={`Enable skills for ${name}`} />
    </div>
  )
}

/** One skill row: bold title, one-line description, muted mono path below. */
function SkillRow({ skill }: { skill: Skill }): JSX.Element {
  return (
    <div className="border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="text-[13px] font-semibold">{skill.name}</div>
      {skill.description !== '' && (
        <div className="truncate text-xs text-muted-foreground">{skill.description}</div>
      )}
      <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">{skill.path}</div>
    </div>
  )
}

function SkillsBody({ client }: { client: AxiosInstance }): JSX.Element {
  const api = skillsApi(client)
  const [config, setConfig] = useState<SkillsConfig>({ folder: null, enabled: {} })
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [listing, setListing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmAgent, setConfirmAgent] = useState<{ id: string; name: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshSkills = useCallback(
    (folder: string | null) => {
      if (folder === null) {
        setSkills([])
        return
      }
      setListing(true)
      void api
        .list()
        .then(setSkills)
        .catch(() => setSkills([]))
        .finally(() => setListing(false))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  useEffect(() => {
    setLoading(true)
    void api
      .getConfig()
      .then((cfg) => {
        setConfig(cfg)
        refreshSkills(cfg.folder)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const persist = useCallback(
    (next: SkillsConfig) => {
      setConfig(next)
      void api.setConfig(next).catch(() => undefined)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  const chooseFolder = useCallback(() => {
    void window.executioner.pickFolder().then((dir) => {
      if (dir === undefined) return
      const next: SkillsConfig = { folder: dir, enabled: config.enabled }
      persist(next)
      refreshSkills(dir)
    })

  }, [config.enabled, persist, refreshSkills])

  const clearFolder = useCallback(() => {
    persist({ folder: null, enabled: config.enabled })
    setSkills([])

  }, [config.enabled, persist])

  const setEnabled = useCallback(
    (id: string, value: boolean) => {
      persist({ folder: config.folder, enabled: { ...config.enabled, [id]: value } })
    },
    [config.folder, config.enabled, persist],
  )

  const generateAgentsMd = useCallback(() => {
    setBusy(true)
    setNotice(null)
    void api
      .generateAgentsMd()
      .then((res) => setNotice(`AGENTS.md updated with ${res.count} skill${res.count === 1 ? '' : 's'}.`))
      .catch(() => setNotice('Could not generate AGENTS.md.'))
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // Fallback agent toggled ON → confirm generating AGENTS.md; either way we save
  // the enabled intent. Toggling OFF just saves.
  const onFallbackToggle = useCallback(
    (agent: { id: string; name: string }, next: boolean) => {
      if (next) {
        setConfirmAgent(agent)
      } else {
        setEnabled(agent.id, false)
      }
    },
    [setEnabled],
  )

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <>
      {/* 1. Folder card */}
      <div className="rounded-lg border border-border bg-card p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
            <FolderOpen className="size-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Skills folder</div>
            {config.folder !== null ? (
              <div className="truncate font-mono text-[11px] text-muted-foreground">{config.folder}</div>
            ) : (
              <div className="text-[11.5px] text-muted-foreground">No folder selected</div>
            )}
          </div>
          {config.folder !== null && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={clearFolder}>
              <X className="size-3.5" /> Clear
            </Button>
          )}
          <Button variant="outline" size="sm" className="shrink-0" onClick={chooseFolder}>
            Choose folder…
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Don&apos;t have any offensive skills? Check out the{' '}
        <a
          href="https://github.com/dbx0/skills"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2 hover:text-primary"
        >
          author skills
        </a>
        .
      </p>

      {/* 2. Per-agent activation */}
      <GroupLabel>Enable for agents</GroupLabel>
      <div className="rounded-lg border border-border bg-card px-3.5">
        {SKILL_FLAG_AGENTS.map((a) => (
          <AgentRow
            key={a.id}
            id={a.id}
            name={a.name}
            hint="Loads skills natively at launch."
            checked={config.enabled[a.id] === true}
            disabled={config.folder === null}
            onToggle={(next) => setEnabled(a.id, next)}
          />
        ))}
        {FALLBACK_AGENTS.map((a) => (
          <AgentRow
            key={a.id}
            id={a.id}
            name={a.name}
            hint="Uses a generated AGENTS.md in the engagement root."
            checked={config.enabled[a.id] === true}
            disabled={config.folder === null}
            onToggle={(next) => onFallbackToggle(a, next)}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={config.folder === null || busy} onClick={generateAgentsMd}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Regenerate AGENTS.md
        </Button>
        {notice !== null && <span className="text-[11.5px] text-muted-foreground">{notice}</span>}
      </div>

      {/* 3. Skills list — one scrollable card, not an endless run of cards. */}
      <GroupLabel>Discovered skills{skills.length > 0 ? ` (${skills.length})` : ''}</GroupLabel>
      {config.folder === null ? (
        <p className="text-xs text-muted-foreground">Choose a skills folder to see the skills it contains.</p>
      ) : listing ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Scanning…
        </div>
      ) : skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">No skills found in this folder.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto scrollbar-sleek rounded-lg border border-border bg-card">
          {skills.map((s) => (
            <SkillRow key={s.path} skill={s} />
          ))}
        </div>
      )}

      {confirmAgent !== null && (
        <ConfirmModal
          title="Generate AGENTS.md?"
          message={`Generate AGENTS.md so ${confirmAgent.name} can use these skills? It reads AGENTS.md from the engagement root at launch.`}
          confirmLabel="Generate"
          onConfirm={() => {
            setEnabled(confirmAgent.id, true)
            generateAgentsMd()
            setConfirmAgent(null)
          }}
          onCancel={() => {
            // Still save the enabled intent; note AGENTS.md was not regenerated.
            setEnabled(confirmAgent.id, true)
            setNotice('Enabled — AGENTS.md was not regenerated. Use “Regenerate AGENTS.md” when ready.')
            setConfirmAgent(null)
          }}
        />
      )}
    </>
  )
}

/** Settings → Skills: point spawned agents at a folder of Agent Skills. */
export function SkillsSection(): JSX.Element {
  const client = useApp((s) => s.client)
  return (
    <div>
      <PageHeading title="Skills" description="Point spawned agents at a folder of Agent Skills. The folder and its toggles are yours, in every engagement." />
      {client === null ? (
        <p className="text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline size-3.5" /> Open an engagement to configure skills.
        </p>
      ) : (
        <SkillsBody client={client} />
      )}
    </div>
  )
}
