import type { JSX } from 'react'
import { useState } from 'react'
import { TerminalSquare, ChevronDown, Check } from 'lucide-react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { Button } from '../../components/ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu.js'
import { AGENT_LABELS } from '../../lib/agent-labels.js'

const AGENT_ORDER = ['claude', 'codex', 'opencode', 'gemini', 'cursor', 'hermes']

/** Remember the last agent the user picked so re-entering the empty workspace
 *  keeps their choice instead of snapping back to the default. */
let lastAgentChoice: string | undefined

/**
 * The empty-workspace launchers: a Terminal button and a split Agent button. The
 * main part launches the currently SELECTED agent; the arrow only changes which
 * agent is selected (it does not start a session). Only installed agents are
 * offered (machine-wide status).
 */
export function EmptySessionActions(): JSX.Element {
  const createSession = useApp((s) => s.createSession)
  const installed = useApp((s) => s.installedAgents)
  const defaultAgent = useApp((s) => s.defaultAgent)
  const agents = AGENT_ORDER.filter((id) => installed === null || installed.includes(id))
  // Prefer the onboarding-chosen default agent when it's installed, else Claude.
  const preferred =
    defaultAgent !== null && agents.includes(defaultAgent)
      ? defaultAgent
      : agents.includes('claude')
        ? 'claude'
        : agents[0]

  const [selected, setSelected] = useState<string | undefined>(lastAgentChoice)
  const choose = (id: string): void => {
    lastAgentChoice = id
    setSelected(id)
  }
  // Keep the selection valid as the installed-agent list resolves.
  const current = selected !== undefined && agents.includes(selected) ? selected : preferred

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => void createSession({ kind: 'shell' })}>
        <TerminalSquare className="size-4" strokeWidth={1.75} />
        Terminal
      </Button>

      {current !== undefined && (
        <div className="inline-flex overflow-hidden rounded-md">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-r-none"
            onClick={() => void createSession({ agent: current })}
          >
            <AgentIcon agent={current} className="size-4" />
            {AGENT_LABELS[current] ?? current}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Choose an agent"
                className="rounded-l-none border-l border-border-subtle px-1.5"
              >
                <ChevronDown className="size-4" strokeWidth={1.75} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {agents.map((id) => (
                <DropdownMenuItem key={id} onSelect={() => choose(id)}>
                  <AgentIcon agent={id} className="size-4" />
                  {AGENT_LABELS[id] ?? id}
                  {id === current && <Check className="ml-auto size-3.5 text-muted-foreground" strokeWidth={2} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
