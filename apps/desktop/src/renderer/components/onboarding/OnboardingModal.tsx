import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Check, Monitor, Server, Container, FolderOpen, FolderPlus, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useApp, type ExecutionMode } from '../../store.js'
import { THEMES } from '../../lib/themes.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { OnboardingConnectionStep } from './OnboardingConnectionStep.js'
import { OnboardingWorkspaceStep } from './OnboardingWorkspaceStep.js'
import { empty, type FormState } from '../modals/backends/form-state.js'
import { Button } from '../ui/button.js'
import { cn } from '../../lib/utils.js'

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

type StepId = 'agent' | 'theme' | 'exec' | 'engagement' | 'workspace' | 'connection'

const STEP_META: Record<StepId, { title: string; subtitle: string }> = {
  agent: {
    title: 'Default agent',
    subtitle: 'Pick the agent new sessions start with. Only installed CLIs can be chosen.',
  },
  theme: {
    title: 'Theme',
    subtitle: 'Choose how the workspace looks. You can change this any time in Settings.',
  },
  exec: {
    title: 'Execution',
    subtitle: 'How should work run by default? Pick SSH or Docker to configure it next.',
  },
  engagement: {
    title: 'Engagement',
    subtitle: 'Open an existing engagement or create a new one to get started.',
  },
  connection: {
    title: 'Connection details',
    subtitle: 'Enter the connection and verify it — a passing test is what unlocks the last step.',
  },
  workspace: {
    title: 'Engagement',
    subtitle: 'Saving runs through an engagement\u2019s engine. Open or create one; the connection itself is kept for all of them.',
  },
}

/** The workspace step's subtitle depends on whether an engagement is open yet, so
 *  the header never asks for one that is already there. */
function subtitleFor(stepId: StepId, hasEngagement: boolean): string {
  if (stepId === 'workspace' && hasEngagement) return 'Storing the verified connection, ready in every engagement.'
  return STEP_META[stepId].subtitle
}

/**
 * First-launch onboarding: a stepped wizard that sets the default
 * agent, theme, and execution preference, then lands the user in an engagement.
 * Choosing SSH or Docker adds a final backend-setup step (with a liveness test)
 * that must save before onboarding finishes. Shown once (persisted via the
 * store's onboarding flag); "Skip" or finishing both mark it complete.
 */
export function OnboardingModal(): JSX.Element | null {
  const open = useApp((s) => s.onboardingOpen)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const defaultAgent = useApp((s) => s.defaultAgent)
  const setDefaultAgent = useApp((s) => s.setDefaultAgent)
  const defaultExecution = useApp((s) => s.defaultExecution)
  const setDefaultExecution = useApp((s) => s.setDefaultExecution)
  const completeOnboarding = useApp((s) => s.completeOnboarding)
  const openEngagement = useApp((s) => s.openEngagement)
  const newEngagementOpen = useApp((s) => s.newEngagementOpen)
  const client = useApp((s) => s.client)

  const [stepIdx, setStepIdx] = useState(0)
  const [availability, setAvailability] = useState<Record<string, boolean> | null>(null)
  const [busy, setBusy] = useState(false)

  // SSH/Docker collect their connection details on their own step, then finish on
  // the backend step (which first opens a workspace, since a backend lives inside
  // an engagement); Local ends on the engagement step.
  const needsBackend = defaultExecution === 'ssh' || defaultExecution === 'docker'
  const kind = defaultExecution === 'docker' ? 'docker' : 'ssh'
  const steps: StepId[] = needsBackend
    ? ['agent', 'theme', 'exec', 'connection', 'workspace']
    : ['agent', 'theme', 'exec', 'engagement']
  const stepId = steps[Math.min(stepIdx, steps.length - 1)] ?? 'agent'

  // The backend details, collected and verified on the connection step. Held here
  // so stepping back and forth doesn't lose what was typed.
  const [form, setForm] = useState<FormState>(() => ({ ...empty, kind, name: kind }))
  const setFormPatch = (patch: Partial<FormState>): void => setForm((f) => ({ ...f, ...patch }))
  // Carried from a password enrollment on the connection step to the save below.
  const [enrolledKey, setEnrolledKey] = useState<string | null>(null)

  // Switching SSH <-> Docker on the exec step retargets the form; the name follows
  // along only while it is still the untouched default.
  useEffect(() => {
    setForm((f) =>
      f.kind === kind ? f : { ...f, kind, name: f.name === '' || f.name === 'ssh' || f.name === 'docker' ? kind : f.name },
    )
  }, [kind])

  // Probe installed agent CLIs when the agent step opens (works before any engine
  // is running, via the main-process PATH check).
  useEffect(() => {
    if (!open) return
    let alive = true
    const probe = window.executioner?.checkAgents?.()
    if (probe === undefined) {
      setAvailability({})
    } else {
      void probe
        .then((rows) => alive && setAvailability(Object.fromEntries(rows.map((r) => [r.id, r.installed]))))
        .catch(() => alive && setAvailability({}))
    }
    return () => {
      alive = false
    }
  }, [open])

  const agentChosen = defaultAgent !== null && availability?.[defaultAgent] === true

  if (!open) return null
  // Step aside while the New-engagement modal is up rather than stacking two
  // dialogs. This component stays mounted, so the wizard comes back on the same
  // step — with an engagement now open — to save the verified backend.
  if (newEngagementOpen) return null

  // Local engagement launch: open an existing folder directly, or finish
  // onboarding and hand a NEW engagement off to the 3-tab New-engagement modal.
  const openWith = (create: boolean): void => {
    if (create) {
      completeOnboarding()
      useApp.getState().openNewEngagement()
      return
    }
    setBusy(true)
    completeOnboarding()
    void openEngagement(false).finally(() => setBusy(false))
  }

  // Backend flow: open/create a workspace WITHOUT finishing (its engine hosts the
  // backend); the verified profile is saved into it on the step below. Creating
  // goes through the same New-engagement modal as the sidebar's +, so an
  // engagement started here gets a name, icon, description and scope like any
  // other — not just a folder basename.
  const openForBackend = (create: boolean): void => {
    if (create) {
      useApp.getState().openNewEngagement()
      return
    }
    setBusy(true)
    void openEngagement(false).finally(() => setBusy(false))
  }

  // Progress dots shared by the wizard footer and the backend step's footer.
  const dots = steps.map((s, i) => (
    <span key={s} className={cn('size-1.5 rounded-full transition-colors', i === stepIdx ? 'bg-foreground' : 'bg-border')} />
  ))
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-[2px]">
      <div className="flex max-h-[88vh] w-[620px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Step {stepIdx + 1} of {steps.length}
          </div>
          <div className="mt-0.5 text-[16px] font-medium">{STEP_META[stepId].title}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitleFor(stepId, client !== null)}</div>
        </div>

        {stepId === 'connection' ? (
          <OnboardingConnectionStep
            form={form}
            set={setFormPatch}
            dots={dots}
            onBack={() => setStepIdx(steps.indexOf('exec'))}
            onNext={(key) => {
              setEnrolledKey(key)
              setStepIdx(steps.indexOf('workspace'))
            }}
            onSkip={completeOnboarding}
          />
        ) : stepId === 'workspace' ? (
          <OnboardingWorkspaceStep
            client={client}
            form={form}
            identityFile={enrolledKey}
            dots={dots}
            opening={busy}
            onOpen={openForBackend}
            onBack={() => setStepIdx(steps.indexOf('connection'))}
            onSkip={completeOnboarding}
            onDone={completeOnboarding}
          />
        ) : (
          <>
        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-5">
          {stepId === 'agent' && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {AGENTS.map((a) => {
                const installed = availability?.[a.id] === true
                const checking = availability === null
                const selected = defaultAgent === a.id && installed
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!installed && !checking}
                    onClick={() => installed && setDefaultAgent(a.id)}
                    aria-pressed={selected}
                    className={cn(
                      'group relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'selected-surface border-transparent'
                        : 'border-border hover:bg-surface-1',
                      !installed && !checking && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <AgentIcon agent={a.id} className="size-5" />
                      <span className="text-[13px] font-medium">{a.name}</span>
                      {selected && (
                        <span className="ml-auto grid size-4 place-items-center rounded-full bg-foreground text-background">
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{a.blurb}</span>
                    <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                      {checking ? 'Checking…' : installed ? 'Installed' : 'Not installed'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {stepId === 'theme' && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {THEMES.map((t) => {
                const selected = theme === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
                      selected
                        ? 'selected-surface border-transparent'
                        : 'border-border hover:bg-surface-1',
                    )}
                  >
                    <div
                      className="relative h-14 w-full overflow-hidden rounded-md border border-border"
                      style={{ background: t.swatch.bg }}
                    >
                      <span className="absolute left-2 top-2 h-2.5 w-10 rounded-full" style={{ background: t.swatch.fg, opacity: 0.9 }} />
                      <span className="absolute left-2 top-6 h-2 w-7 rounded-full" style={{ background: t.swatch.fg, opacity: 0.5 }} />
                      {selected && (
                        <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-foreground text-background">
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="text-[13px] font-medium">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {stepId === 'exec' && (
            <div className="flex flex-col gap-2.5">
              {EXECS.map((e) => {
                const Icon = e.icon
                const selected = defaultExecution === e.id
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setDefaultExecution(e.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'selected-surface border-transparent'
                        : 'border-border hover:bg-surface-1',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
                      <Icon className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{e.name}</div>
                      <div className="text-[11.5px] text-muted-foreground">{e.blurb}</div>
                    </div>
                    {selected && (
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {stepId === 'engagement' && (
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => openWith(false)}
                className="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-surface-1 disabled:opacity-50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
                  <FolderOpen className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">Open engagement</div>
                  <div className="text-[11.5px] text-muted-foreground">Pick an existing engagement folder.</div>
                </div>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => openWith(true)}
                className="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-surface-1 disabled:opacity-50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
                  <FolderPlus className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">New engagement</div>
                  <div className="text-[11.5px] text-muted-foreground">Create a fresh engagement in a new folder.</div>
                </div>
                {busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={completeOnboarding} className="text-[12px] text-muted-foreground hover:text-foreground">
            Skip setup
          </button>

          {/* Progress dots */}
          <div className="mx-auto flex items-center gap-1.5">{dots}</div>

          {stepIdx > 0 ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStepIdx((s) => s - 1)}>
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              Back
            </Button>
          ) : (
            <span className="w-[68px]" />
          )}
          {/* Next advances through the preference steps; the final step (engagement
              or backend) has its own Open/New actions instead. */}
          {stepId !== 'engagement' && (
            <Button size="sm" disabled={stepId === 'agent' && !agentChosen} onClick={() => setStepIdx((s) => s + 1)}>
              Next
              <ArrowRight className="size-4" strokeWidth={1.75} />
            </Button>
          )}
          {stepId === 'engagement' && busy && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Opening…
            </span>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  )
}
