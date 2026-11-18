import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useApp } from '../../store.js'
import { OnboardingConnectionStep } from './OnboardingConnectionStep.js'
import { OnboardingWorkspaceStep } from './OnboardingWorkspaceStep.js'
import { AgentStep, ExecStep, ThemeStep } from './steps.js'
import { EngagementChoices, FooterStatus, StepBody, WizardFooter } from './parts.js'
import { empty, type FormState } from '../modals/backends/form-state.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogTitle } from '../ui/dialog.js'
import { cn } from '../../lib/utils.js'

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
    subtitle: 'Enter the connection and verify it. A passing test is what unlocks the last step.',
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
  // step, with an engagement now open, to save the verified backend.
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
  // other, not just a folder basename.
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
    <span
      key={s}
      className={cn('size-1.5 rounded-full transition-colors', i === stepIdx ? 'bg-foreground' : 'bg-glass-active')}
    />
  ))
  return (
    // The wizard has no way out but its own buttons: Escape and a click outside do nothing.
    <Dialog onClose={() => undefined} dismissable={false} className="w-[620px] max-w-[95vw]">
      <div className="shrink-0 border-b border-glass-border px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Step {stepIdx + 1} of {steps.length}
        </div>
        <DialogTitle className="mt-0.5 text-[16px] font-semibold tracking-[-0.01em]">{STEP_META[stepId].title}</DialogTitle>
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
          <StepBody>
            {stepId === 'agent' && <AgentStep availability={availability} value={defaultAgent} onChange={setDefaultAgent} />}
            {stepId === 'theme' && <ThemeStep value={theme} onChange={setTheme} />}
            {stepId === 'exec' && <ExecStep value={defaultExecution} onChange={setDefaultExecution} />}
            {stepId === 'engagement' && (
              <div className="flex flex-col gap-2.5">
                <EngagementChoices busy={busy} onOpen={openWith} />
              </div>
            )}
          </StepBody>

          <WizardFooter dots={dots} onSkip={completeOnboarding}>
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
            {stepId === 'engagement' && busy && <FooterStatus>Opening…</FooterStatus>}
          </WizardFooter>
        </>
      )}
    </Dialog>
  )
}
