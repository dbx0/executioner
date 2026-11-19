import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ShieldCheck,
  Crosshair,
  Workflow,
  Wrench,
  Bot,
  Terminal,
  Settings,
  FolderOpen,
  FolderPlus,
  SunMoon,
  Target,
  MessageSquare,
 Zap } from 'lucide-react'
import { useApp } from '../store.js'
import { AgentIcon } from './brand/AgentIcon.js'
import { targetsApi, type TargetSummary } from '../api/targets.js'
import { Spinner } from './ui/spinner.js'

const TARGET_LIMIT = 200

/** A result row: a soft pill that takes the selected glass fill under the keyboard cursor. */
const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] text-foreground data-[disabled=true]:opacity-40 data-[selected=true]:bg-glass-active'

/** The small caps heading cmdk renders over each group. */
const groupClass =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground'

export function CommandPalette(): JSX.Element {
  const open = useApp((s) => s.paletteOpen)
  const setPalette = useApp((s) => s.setPalette)
  const setActiveView = useApp((s) => s.setActiveView)
  const openHub = useApp((s) => s.openHub)
  const setPendingTargetId = useApp((s) => s.setPendingTargetId)
  const hasEngagement = useApp((s) => s.connection !== null)
  const openEngagement = useApp((s) => s.openEngagement)
  const openRecent = useApp((s) => s.openRecent)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const recents = useApp((s) => s.recents)
  const client = useApp((s) => s.client)
  const sessions = useApp((s) => s.sessions)
  const setActiveSession = useApp((s) => s.setActiveSession)
  // Agent conversations (not plain shells), searchable by their chat title.
  const chats = sessions.filter((x) => x.agent !== 'shell')

  const [targets, setTargets] = useState<TargetSummary[]>([])
  // The targets read is in flight: the list says so instead of looking complete.
  const [loadingTargets, setLoadingTargets] = useState(false)

  // Refetch targets each time the palette opens so results stay current.
  useEffect(() => {
    if (!open || client === null) {
      setTargets([])
      setLoadingTargets(false)
      return
    }
    let cancelled = false
    setLoadingTargets(true)
    targetsApi(client)
      .list()
      .then((rows) => {
        if (!cancelled) setTargets(rows.slice(0, TARGET_LIMIT))
      })
      .catch(() => {
        if (!cancelled) setTargets([])
      })
      .finally(() => {
        if (!cancelled) setLoadingTargets(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, client])

  const go = (fn: () => void): void => {
    fn()
    setPalette(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setPalette}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-fade-in bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[16%] z-[60] w-full max-w-lg -translate-x-1/2 animate-zoom-in overflow-hidden rounded-panel border border-glass-border bg-popover text-popover-foreground shadow-floating outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command loop>
            <Command.Input
              placeholder="Type a command or search…"
              className="h-12 w-full border-b border-glass-border bg-transparent px-5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="scrollbar-sleek max-h-80 overflow-y-auto p-2">
              {loadingTargets && (
                <Command.Loading>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-muted-foreground">
                    <Spinner size="sm" />
                    Loading targets
                  </div>
                </Command.Loading>
              )}
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>

              <Command.Group heading="Go to" className={groupClass}>
                <Command.Item value="go Scope" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('scope'))} className={itemClass}>
                  <ShieldCheck className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Scope
                </Command.Item>
                <Command.Item value="go Targets" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('targets'))} className={itemClass}>
                  <Crosshair className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Targets
                </Command.Item>
                <Command.Item value="go Actions" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('actions'))} className={itemClass}>
                  <Zap className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Actions
                </Command.Item>
                <Command.Item value="go Workflows" disabled={!hasEngagement} onSelect={() => go(() => openHub('workflows'))} className={itemClass}>
                  <Workflow className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Workflows
                </Command.Item>
                <Command.Item value="go Tools" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('tools'))} className={itemClass}>
                  <Wrench className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Tools
                </Command.Item>
                <Command.Item value="go Agents" disabled={!hasEngagement} onSelect={() => go(() => openHub('agents'))} className={itemClass}>
                  <Bot className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Agents
                </Command.Item>
                <Command.Item value="go Terminals" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('terminals'))} className={itemClass}>
                  <Terminal className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Terminals
                </Command.Item>
                <Command.Item value="go Settings" disabled={!hasEngagement} onSelect={() => go(() => setActiveView('settings'))} className={itemClass}>
                  <Settings className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Settings
                </Command.Item>
              </Command.Group>

              {/* Chats: open agent conversations, searchable by title, shown before targets. */}
              {chats.length > 0 && (
                <Command.Group heading="Chats" className={groupClass}>
                  {chats.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`chat ${c.title ?? c.label} ${c.agent}`}
                      onSelect={() =>
                        go(() => {
                          setActiveSession(c.id)
                          setActiveView('terminals')
                        })
                      }
                      className={itemClass}
                    >
                      <AgentIcon agent={c.agent} className="size-4 text-muted-foreground" />
                      <span className="truncate">{c.title ?? c.label}</span>
                      <MessageSquare className="ml-auto size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* region: targets-search (owned by targets-search agent) */}
              {targets.length > 0 && (
                <Command.Group heading="Targets" className={groupClass}>
                  {targets.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`target ${t.value} ${t.kind}`}
                      onSelect={() =>
                        go(() => {
                          setPendingTargetId(t.id)
                          setActiveView('targets')
                        })
                      }
                      className={itemClass}
                    >
                      <Target className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      <span className="truncate">{t.value}</span>
                      <span className="ml-auto shrink-0 rounded-control border border-glass-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.kind}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {/* endregion: targets-search */}

              <Command.Group heading="Engagement" className={groupClass}>
                <Command.Item value="open engagement" onSelect={() => go(() => void openEngagement(false))} className={itemClass}>
                  <FolderOpen className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Open engagement…
                </Command.Item>
                <Command.Item value="new engagement" onSelect={() => go(() => useApp.getState().openNewEngagement())} className={itemClass}>
                  <FolderPlus className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  New engagement…
                </Command.Item>
                <Command.Item value="toggle theme" onSelect={() => go(toggleTheme)} className={itemClass}>
                  <SunMoon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  Toggle theme
                </Command.Item>
              </Command.Group>

              {recents.length > 0 && (
                <Command.Group heading="Recent" className={groupClass}>
                  {recents.map((r) => (
                    <Command.Item
                      key={r.root}
                      value={`recent ${r.name} ${r.root}`}
                      onSelect={() => go(() => void openRecent(r.root))}
                      className={itemClass}
                    >
                      <FolderPlus className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      <span className="truncate">{r.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
