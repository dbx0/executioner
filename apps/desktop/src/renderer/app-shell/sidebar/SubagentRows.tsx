import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { subtreeHasWorking, type SubagentNode } from '../../lib/subagent-tree.js'
import { cn } from '../../lib/utils.js'
import { AgentStatusDot } from '../../components/brand/AgentStatusDot.js'

/**
 * One sub-agent row plus its own nested sub-agents, rendered recursively. Each
 * node carries its own expand/collapse chevron (default expanded) and a status
 * dot that stays "working" while it OR any descendant runs — so a parent row
 * keeps spinning until its whole sub-tree settles.
 */
export function SubagentNodeRow({ node }: { node: SubagentNode }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const hasChildren = node.children.length > 0
  const working = subtreeHasWorking(node)

  return (
    <div>
      <div className="flex h-6 items-center gap-1 rounded-md pr-2 text-[12px] text-muted-foreground">
        <button
          type="button"
          aria-label={collapsed ? 'Expand sub-agents' : 'Collapse sub-agents'}
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-sidebar-foreground',
            !hasChildren && 'invisible',
          )}
        >
          <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} strokeWidth={2} />
        </button>
        <span className="min-w-0 flex-1 truncate">{node.description}</span>
        {working ? (
          <AgentStatusDot state="working" className="ml-auto size-2" />
        ) : (
          <span className="ml-auto text-status-success">✓</span>
        )}
      </div>
      {hasChildren && !collapsed && <SubagentChildren nodes={node.children} />}
    </div>
  )
}

/** A nested level of sub-agent rows, indented with a lineage guide-line. */
export function SubagentChildren({ nodes }: { nodes: SubagentNode[] }): JSX.Element {
  return (
    <div className="ml-[1.15rem] flex flex-col gap-0.5 border-l border-border pl-1.5">
      {nodes.map((node) => (
        <SubagentNodeRow key={node.id} node={node} />
      ))}
    </div>
  )
}
