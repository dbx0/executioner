import type { JSX } from 'react'
import { createContext, useContext, useState } from 'react'
import { Handle, NodeToolbar, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow'
import { GitBranch, Repeat, OctagonX, Bot, Wrench, Braces, GitMerge, Database, ShieldAlert, Globe, Bell, MapPin, Radar, ScanSearch, Camera, FileCode, MousePointerClick, Clock, Sparkles, Copy, Trash2, Play, Plus } from 'lucide-react'
import { categoryColor, type NodeKind } from '../../lib/node-catalog.js'
import type { ParamSpec } from './ParamDrawer.js'
import { cn } from '../../lib/utils.js'
import { useCanvas } from './CanvasContext.js'

export interface GraphNodeData {
  label: string
  nodeType: string
  kind: NodeKind
  category: string
  availableParams: ParamSpec[]
  params: Record<string, unknown>
  status?: 'running' | 'success' | 'error'
  /** Latest captured stdout/output for this node in the current run (live). */
  output?: string
}

/**
 * Ids of nodes that were just added (by hand, paste or AI Apply). Provided by the
 * editor; the default is empty so a node outside it never animates.
 */
export const NewNodeIdsContext = createContext<ReadonlySet<string>>(new Set())

const STATUS_RING: Record<string, string> = {
  running: 'ring-2 ring-status-running',
  success: 'ring-2 ring-status-success',
  error: 'ring-2 ring-status-error',
}

function Shell({
  id,
  data,
  selected,
  icon,
  children,
}: {
  id: string
  data: GraphNodeData
  selected: boolean
  icon: JSX.Element
  children?: React.ReactNode
}): JSX.Element {
  const color = categoryColor(data.category)
  const { onDuplicate, onDelete, onAppend, onRunNode } = useCanvas()
  const [hovered, setHovered] = useState(false)
  const isNew = useContext(NewNodeIdsContext).has(id)
  const updateNodeInternals = useUpdateNodeInternals()
  // The animation lives on an inner wrapper, not the reactflow node root, which
  // positions itself with a transform that an animated transform would override.
  // Reactflow measured the handles mid-scale, so measure again once it settles.
  return (
    <div
      className={isNew ? 'motion-safe:animate-node-in' : undefined}
      onAnimationEnd={isNew ? () => updateNodeInternals(id) : undefined}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'relative min-w-[150px] rounded-lg border border-border bg-card text-card-foreground shadow-sm',
          selected && 'ring-2 ring-ring',
          data.status !== undefined && STATUS_RING[data.status],
        )}
      >
        <NodeToolbar isVisible={hovered || selected} position={Position.Top} offset={6}>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-floating">
            {data.kind === 'tool' && (
              <button
                type="button"
                className="nodrag flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-status-success"
                title="Run this node"
                onClick={(e) => {
                  e.stopPropagation()
                  onRunNode(id)
                }}
              >
                <Play className="size-3.5" strokeWidth={1.75} />
              </button>
            )}
            {data.kind !== 'stop' && (
              <button
                type="button"
                className="nodrag flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                title="Append node"
                onClick={(e) => {
                  e.stopPropagation()
                  onAppend(id)
                }}
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </button>
            )}
            <button
              type="button"
              className="nodrag flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation()
                onDuplicate(id)
              }}
            >
              <Copy className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="nodrag flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-status-error"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(id)
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </NodeToolbar>
        <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg" style={{ background: color }} />
        <div className="flex items-center gap-2 px-3 py-2 pl-3.5">
          <span className="flex size-5 items-center justify-center" style={{ color }}>
            {icon}
          </span>
          <span className="truncate text-[13px] font-medium">{data.label}</span>
          {data.kind === 'agent' && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {String(data.params.agent ?? 'claude')}
            </span>
          )}
          {data.status === 'running' && (
            <span className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-status-running" />
          )}
          {data.status === 'success' && <span className="ml-auto text-status-success">✓</span>}
          {data.status === 'error' && <span className="ml-auto text-status-error">✗</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

const handleClass = '!size-2.5 !border-2 !border-background !bg-muted-foreground'

export function ToolNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Wrench className="size-4" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Handle type="source" position={Position.Right} className={handleClass} />
    </Shell>
  )
}

export function AgentNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Bot className="size-4" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Handle type="source" position={Position.Right} className={handleClass} />
    </Shell>
  )
}

function LabeledHandle({ id, top, label, color }: { id: string; top: string; label: string; color: string }): JSX.Element {
  return (
    <>
      <Handle
        type="source"
        id={id}
        position={Position.Right}
        style={{ top }}
        className="!size-2.5 !border-2 !border-background"
      />
      <span
        className="absolute -right-1 translate-x-full whitespace-nowrap text-[10px] font-medium"
        style={{ top: `calc(${top} - 7px)`, color }}
      >
        {label}
      </span>
    </>
  )
}

export function IfNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<GitBranch className="size-4" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="h-6" />
      <LabeledHandle id="true" top="62%" label="true" color="var(--status-success)" />
      <LabeledHandle id="false" top="84%" label="false" color="var(--status-error)" />
    </Shell>
  )
}

export function LoopNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Repeat className="size-4" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="h-6" />
      <LabeledHandle id="body" top="62%" label="body" color="var(--ai)" />
      <LabeledHandle id="done" top="84%" label="done" color="var(--muted-foreground)" />
    </Shell>
  )
}

export function StopNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<OctagonX className="size-4" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} className={handleClass} />
    </Shell>
  )
}

/** An entry/trigger node: no inbound handle, one outbound source handle. */
function triggerNode(icon: JSX.Element) {
  return function TriggerNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
    return (
      <Shell id={id} data={data} selected={selected} icon={icon}>
        <Handle type="source" position={Position.Right} className={handleClass} />
      </Shell>
    )
  }
}

export const ManualTriggerNode = triggerNode(<MousePointerClick className="size-4" strokeWidth={1.75} />)
export const ScheduleTriggerNode = triggerNode(<Clock className="size-4" strokeWidth={1.75} />)
export const OnCreateTriggerNode = triggerNode(<Sparkles className="size-4" strokeWidth={1.75} />)

/** A simple in/out node whose only variation is its icon (data-flow + integration). */
function flowNode(icon: JSX.Element) {
  return function FlowNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
    return (
      <Shell id={id} data={data} selected={selected} icon={icon}>
        <Handle type="target" position={Position.Left} className={handleClass} />
        <Handle type="source" position={Position.Right} className={handleClass} />
      </Shell>
    )
  }
}

export const SetVariableNode = flowNode(<Braces className="size-4" strokeWidth={1.75} />)
export const MergeNode = flowNode(<GitMerge className="size-4" strokeWidth={1.75} />)
export const SaveToTargetNode = flowNode(<Database className="size-4" strokeWidth={1.75} />)
// The same shield the Findings section uses in the sidebar.
export const SaveToFindingNode = flowNode(<ShieldAlert className="size-4" strokeWidth={1.75} />)
export const HttpRequestNode = flowNode(<Globe className="size-4" strokeWidth={1.75} />)
export const NotifyNode = flowNode(<Bell className="size-4" strokeWidth={1.75} />)
export const GeoipNode = flowNode(<MapPin className="size-4" strokeWidth={1.75} />)
export const ShodanNode = flowNode(<Radar className="size-4" strokeWidth={1.75} />)
export const CensysNode = flowNode(<ScanSearch className="size-4" strokeWidth={1.75} />)
export const ScreenshotNode = flowNode(<Camera className="size-4" strokeWidth={1.75} />)
export const PythonScriptNode = flowNode(<FileCode className="size-4" strokeWidth={1.75} />)

export const graphNodeTypes = {
  tool: ToolNode,
  agent: AgentNode,
  manual: ManualTriggerNode,
  schedule: ScheduleTriggerNode,
  on_create: OnCreateTriggerNode,
  if: IfNode,
  loop: LoopNode,
  stop: StopNode,
  set_variable: SetVariableNode,
  merge: MergeNode,
  save_to_target: SaveToTargetNode,
  save_to_finding: SaveToFindingNode,
  http_request: HttpRequestNode,
  notify: NotifyNode,
  geoip: GeoipNode,
  shodan: ShodanNode,
  censys: CensysNode,
  screenshot: ScreenshotNode,
  python_script: PythonScriptNode,
}
