import type { JSX } from 'react'
import { createContext, useContext, useState } from 'react'
import { Handle, NodeToolbar, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow'
import { GitBranch, Repeat, OctagonX, Bot, Wrench, Braces, GitMerge, Database, ShieldAlert, Globe, Bell, MapPin, Radar, ScanSearch, Lock, ListTree, Network, Cloud, Camera, FileCode, MousePointerClick, Check, X } from 'lucide-react'
import { categoryColor, type NodeKind } from '../../lib/node-catalog.js'
import type { ParamSpec } from './ParamDrawer.js'
import { cn } from '../../lib/utils.js'
import { Spinner } from '../ui/spinner.js'
import { NodeActions } from './NodeActions.js'

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

/** The run state at the right of a node's title row. */
function StatusMark({ status }: { status: GraphNodeData['status'] }): JSX.Element | null {
  if (status === 'running') return <Spinner size="sm" className="ml-auto text-status-running" />
  if (status === 'success') return <Check aria-label="Succeeded" className="ml-auto size-3.5 shrink-0 text-status-success" strokeWidth={2.5} />
  if (status === 'error') return <X aria-label="Failed" className="ml-auto size-3.5 shrink-0 text-status-error" strokeWidth={2.5} />
  return null
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
          // A glass card, but on an opaque surface, so the edges that run
          // behind a node do not show through it.
          'glass-panel relative min-w-[160px] rounded-[14px] text-foreground transition-colors',
          selected ? 'border-border-strong bg-surface-3' : 'bg-surface-1',
          data.status !== undefined && STATUS_RING[data.status],
        )}
      >
        <NodeToolbar isVisible={hovered || selected} position={Position.Top} offset={6}>
          <NodeActions id={id} kind={data.kind} />
        </NodeToolbar>
        <div className="flex items-center gap-2 py-2 pl-2 pr-3">
          {/* The category colour is catalog data, so it cannot be a utility class. */}
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-glass-strong"
            style={{ color: categoryColor(data.category) }}
          >
            {icon}
          </span>
          <span className="truncate text-[13px] font-medium">{data.label}</span>
          {data.kind === 'agent' && (
            <span className="shrink-0 rounded-control bg-glass-strong px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {String(data.params.agent ?? 'claude')}
            </span>
          )}
          <StatusMark status={data.status} />
        </div>
        {children}
      </div>
    </div>
  )
}

export function ToolNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Wrench className="size-3.5" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </Shell>
  )
}

export function AgentNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Bot className="size-3.5" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
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
        // Each branch port sits at its own height on the card edge.
        style={{ top }}
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
    <Shell id={id} data={data} selected={selected} icon={<GitBranch className="size-3.5" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} />
      <div className="h-6" />
      <LabeledHandle id="true" top="62%" label="true" color="var(--status-success)" />
      <LabeledHandle id="false" top="84%" label="false" color="var(--status-error)" />
    </Shell>
  )
}

export function LoopNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<Repeat className="size-3.5" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} />
      <div className="h-6" />
      <LabeledHandle id="body" top="62%" label="body" color="var(--ai)" />
      <LabeledHandle id="done" top="84%" label="done" color="var(--muted-foreground)" />
    </Shell>
  )
}

export function StopNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
  return (
    <Shell id={id} data={data} selected={selected} icon={<OctagonX className="size-3.5" strokeWidth={1.75} />}>
      <Handle type="target" position={Position.Left} />
    </Shell>
  )
}

/** An entry/trigger node: no inbound handle, one outbound source handle. */
function triggerNode(icon: JSX.Element) {
  return function TriggerNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
    return (
      <Shell id={id} data={data} selected={selected} icon={icon}>
        <Handle type="source" position={Position.Right} />
      </Shell>
    )
  }
}

export const ManualTriggerNode = triggerNode(<MousePointerClick className="size-3.5" strokeWidth={1.75} />)

/** A simple in/out node whose only variation is its icon (data-flow + integration). */
function flowNode(icon: JSX.Element) {
  return function FlowNode({ id, data, selected }: NodeProps<GraphNodeData>): JSX.Element {
    return (
      <Shell id={id} data={data} selected={selected} icon={icon}>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </Shell>
    )
  }
}

export const SetVariableNode = flowNode(<Braces className="size-3.5" strokeWidth={1.75} />)
export const MergeNode = flowNode(<GitMerge className="size-3.5" strokeWidth={1.75} />)
export const SaveToTargetNode = flowNode(<Database className="size-3.5" strokeWidth={1.75} />)
// The same shield the Findings section uses in the sidebar.
export const SaveToFindingNode = flowNode(<ShieldAlert className="size-3.5" strokeWidth={1.75} />)
export const HttpRequestNode = flowNode(<Globe className="size-3.5" strokeWidth={1.75} />)
export const NotifyNode = flowNode(<Bell className="size-3.5" strokeWidth={1.75} />)
export const GeoipNode = flowNode(<MapPin className="size-3.5" strokeWidth={1.75} />)
export const ShodanNode = flowNode(<Radar className="size-3.5" strokeWidth={1.75} />)
export const CensysNode = flowNode(<ScanSearch className="size-3.5" strokeWidth={1.75} />)
export const TlsCertNode = flowNode(<Lock className="size-3.5" strokeWidth={1.75} />)
export const DnsRecordsNode = flowNode(<ListTree className="size-3.5" strokeWidth={1.75} />)
export const AsnNode = flowNode(<Network className="size-3.5" strokeWidth={1.75} />)
export const CloudBucketsNode = flowNode(<Cloud className="size-3.5" strokeWidth={1.75} />)
export const ScreenshotNode = flowNode(<Camera className="size-3.5" strokeWidth={1.75} />)
export const PythonScriptNode = flowNode(<FileCode className="size-3.5" strokeWidth={1.75} />)

export const graphNodeTypes = {
  tool: ToolNode,
  agent: AgentNode,
  manual: ManualTriggerNode,
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
  tls_cert: TlsCertNode,
  dns_records: DnsRecordsNode,
  asn: AsnNode,
  cloud_buckets: CloudBucketsNode,
  screenshot: ScreenshotNode,
  python_script: PythonScriptNode,
}
