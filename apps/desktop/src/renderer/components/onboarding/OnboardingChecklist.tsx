import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useApp } from '../../store.js'
import { skillsApi } from '../../api/skills.js'
import { secretsApi } from '../../api/secrets.js'
import { backendsApi } from '../../api/backends.js'
import { agentMcpApi, isWired, type AgentMcpWiring } from '../../api/agent-mcp.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'

const DISMISS_KEY = 'exe.onboardingDismissed'

/** Read the persisted dismissed flag (guarded — storage may be unavailable). */
function loadDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

/** Persist the dismissed flag (guarded). */
function saveDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    /* storage unavailable */
  }
}

/** True when the browser exposes the Notifications API and permission is granted. */
function notificationsGranted(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted'
  } catch {
    return false
  }
}

interface ItemView {
  id: string
  label: string
  hint: string
  done: boolean
  /** The right-hand action; omitted (via done) means "Done" is shown instead. */
  onAction: () => void
  actionLabel: string
}

/**
 * A "Getting started" checklist. Each row shows a status dot on the left and an
 * action button (or a muted "Done") on the right.
 *
 * `embedded` (Settings → General): always shown while an engagement is connected,
 * with no dismiss and no auto-hide when complete — a persistent setup reference.
 * Otherwise (the floating variant) it is dismissible and hides once dismissed or
 * all steps are complete.
 */
export function OnboardingChecklist({ embedded = false }: { embedded?: boolean }): JSX.Element | null {
  const client = useApp((s) => s.client)
  const installedAgents = useApp((s) => s.installedAgents)
  const openSettings = useApp((s) => s.openSettings)

  const [dismissed, setDismissed] = useState(loadDismissed)

  // Async-derived done-states (null = not yet loaded → treated as not-done).
  const [skillsDone, setSkillsDone] = useState(false)
  const [secretsDone, setSecretsDone] = useState(false)
  const [backendsDone, setBackendsDone] = useState(false)
  const [notifDone, setNotifDone] = useState(notificationsGranted)
  const [mcpInjectable, setMcpInjectable] = useState<string[]>([])
  const [mcpConfig, setMcpConfig] = useState<AgentMcpWiring>({ enabled: {} })

  const agentsDone = (installedAgents?.length ?? 0) >= 1
  // The project MCP is wired once at least one installed injectable agent has
  // its wiring on (injection is on by default, so this is done as soon as such
  // an agent is installed, unless the user turned it off in Settings → Agents).
  const mcpDone = mcpInjectable.some((a) => (installedAgents ?? []).includes(a) && isWired(mcpConfig, a))

  // Recompute the async checks. Runs on mount / when the engagement changes and
  // when the window regains focus (a light re-check after the user acts elsewhere).
  const recheck = useCallback(async () => {
    setNotifDone(notificationsGranted())
    if (client === null) return
    try {
      const config = await skillsApi(client).getConfig()
      setSkillsDone(config.folder !== null)
    } catch {
      setSkillsDone(false)
    }
    try {
      const rows = await secretsApi(client).list()
      setSecretsDone(rows.length >= 1)
    } catch {
      setSecretsDone(false)
    }
    try {
      const rows = await backendsApi(client).list()
      setBackendsDone(rows.length >= 1)
    } catch {
      setBackendsDone(false)
    }
    try {
      const [{ agents }, cfg] = await Promise.all([
        agentMcpApi(client).injectable(),
        agentMcpApi(client).getConfig(),
      ])
      setMcpInjectable(agents)
      setMcpConfig(cfg)
    } catch {
      setMcpInjectable([])
    }
  }, [client])

  useEffect(() => {
    void recheck()
  }, [recheck])

  useEffect(() => {
    const onFocus = (): void => void recheck()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [recheck])

  const enableNotifications = useCallback(() => {
    try {
      if (typeof Notification === 'undefined') return
      void Notification.requestPermission().then(() => setNotifDone(notificationsGranted()))
    } catch {
      /* API unavailable */
    }
  }, [])

  const items = useMemo<ItemView[]>(
    () => [
      {
        id: 'notifications',
        label: 'Turn on notifications',
        hint: 'Get alerted when runs finish or need you.',
        done: notifDone,
        onAction: enableNotifications,
        actionLabel: 'Enable',
      },
      {
        id: 'agents',
        label: 'Choose your default agent',
        hint: 'Install at least one working agent CLI.',
        done: agentsDone,
        onAction: () => openSettings('agents'),
        actionLabel: 'Set up',
      },
      {
        id: 'agent-mcp',
        label: 'Wire tools into your agent',
        hint: "Give your agent the engagement's targets, findings, and workflows.",
        done: mcpDone,
        onAction: () => openSettings('agents'),
        actionLabel: 'Set up',
      },
      {
        id: 'skills',
        label: 'Load skills',
        hint: 'Point at a folder of reusable skills.',
        done: skillsDone,
        onAction: () => openSettings('skills'),
        actionLabel: 'Set up',
      },
      {
        id: 'secrets',
        label: 'Connect integrations',
        hint: 'Store the secrets your agents need.',
        done: secretsDone,
        onAction: () => openSettings('secrets'),
        actionLabel: 'Set up',
      },
      {
        id: 'backends',
        label: 'Connect a remote worker',
        hint: 'Add a backend to run work remotely.',
        done: backendsDone,
        onAction: () => openSettings('connections'),
        actionLabel: 'Set up',
      },
    ],
    [notifDone, agentsDone, mcpDone, skillsDone, secretsDone, backendsDone, enableNotifications, openSettings],
  )

  const doneCount = items.filter((i) => i.done).length
  const allDone = doneCount === items.length

  // Floating variant only: when every step is complete, auto-hide and mark
  // dismissed so it doesn't flap back on the next re-check. Embedded stays put.
  useEffect(() => {
    if (!embedded && allDone && !dismissed) {
      saveDismissed()
      setDismissed(true)
    }
  }, [embedded, allDone, dismissed])

  const dismiss = useCallback(() => {
    saveDismissed()
    setDismissed(true)
  }, [])

  if (client === null) return null
  if (!embedded && (dismissed || allDone)) return null

  return (
    <div className={embedded ? '' : 'shrink-0 border-b border-border px-4 py-3'}>
      <div className="rounded-lg border border-border bg-surface-1 p-3">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[13px] font-medium">Getting started</span>
          <span className="text-xs text-muted-foreground">
            {doneCount} of {items.length}
          </span>
          {!embedded && (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <ul className="mt-1.5 flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  item.done
                    ? 'bg-status-success text-white'
                    : 'border border-border-strong',
                )}
                aria-hidden
              >
                {item.done && <Check className="size-3" strokeWidth={3} />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{item.label}</div>
                <div className="truncate text-xs text-muted-foreground">{item.hint}</div>
              </div>

              {item.done ? (
                <span className="shrink-0 text-xs text-muted-foreground">Done</span>
              ) : (
                <Button size="sm" variant="outline" onClick={item.onAction} className="shrink-0">
                  {item.actionLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
