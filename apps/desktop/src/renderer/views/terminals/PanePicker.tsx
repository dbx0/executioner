import type { JSX } from 'react'
import { Command } from 'cmdk'
import { FileText, TerminalSquare } from 'lucide-react'
import { useApp } from '../../store.js'
import { ALL_AGENT_ROWS } from '../../components/SpawnMenu.js'
import { Button } from '../../components/ui/button.js'
import { itemKey, leaves, type ItemRef } from '../../lib/pane-tree.js'

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-foreground data-[selected=true]:bg-surface-3 data-[selected=true]:shadow-[inset_0_0_0_1px_var(--border-subtle)]'
const headingClass =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground'

/**
 * What an empty pane shows: the open items that are not already in this layout (those of a
 * multi-pane layout included; picking one moves that pane here) and rows to start something new.
 */
export function PanePicker({ leafId }: { leafId: string }): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const files = useApp((s) => s.files)
  const layouts = useApp((s) => s.layouts)
  const activeLayoutId = useApp((s) => s.activeLayoutId)
  const installedAgents = useApp((s) => s.installedAgents)
  const fillPane = useApp((s) => s.fillPane)
  const createSession = useApp((s) => s.createSession)
  const closePane = useApp((s) => s.closePane)

  const layout = layouts.find((l) => l.id === activeLayoutId)
  const here = new Set(
    layout === undefined ? [] : leaves(layout.root).flatMap((p) => (p.item === null ? [] : [itemKey(p.item)])),
  )
  const others: { ref: ItemRef; title: string }[] = [
    ...sessions.map((s) => ({ ref: { kind: 'terminal', id: s.id }, title: s.title ?? s.label })),
    ...files.map((f) => ({ ref: { kind: 'file', id: f.id }, title: f.title ?? f.name })),
  ].filter((x) => !here.has(itemKey(x.ref)))
  const agentRows = ALL_AGENT_ROWS.filter((r) => installedAgents === null || installedAgents.includes(r.id))

  return (
    <Command loop className="flex h-full flex-col" label="Fill this pane">
      <Command.Input
        autoFocus
        placeholder="Pick a tab or start something new…"
        className="h-10 w-full shrink-0 border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-2">
        <Command.Empty className="py-4 text-center text-sm text-muted-foreground">No results.</Command.Empty>
        {others.length > 0 && (
          <Command.Group heading="Open" className={headingClass}>
            {others.map(({ ref, title }) => (
              <Command.Item
                key={itemKey(ref)}
                value={`open ${itemKey(ref)} ${title}`}
                onSelect={() => fillPane(leafId, ref)}
                className={itemClass}
              >
                {ref.kind === 'file' ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                ) : (
                  <TerminalSquare className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                )}
                <span className="truncate">{title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="New" className={headingClass}>
          <Command.Item value="new Shell" onSelect={() => void createSession({ kind: 'shell' }, { into: leafId })} className={itemClass}>
            <TerminalSquare className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            Shell
          </Command.Item>
          {agentRows.map(({ id, label, Icon }) => (
            <Command.Item
              key={id}
              value={`new ${label}`}
              onSelect={() => void createSession({ agent: id }, { into: leafId })}
              className={itemClass}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      <div className="flex shrink-0 justify-center border-t border-border p-1">
        <Button variant="ghost" size="sm" onClick={() => closePane(leafId)}>
          Close
        </Button>
      </div>
    </Command>
  )
}
