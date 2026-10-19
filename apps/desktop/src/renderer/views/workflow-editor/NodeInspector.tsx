import type { JSX } from 'react'
import type { Edge, Node } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import { IfConditionBuilder } from '../../components/canvas/builders/IfConditionBuilder.js'
import { LoopBuilder } from '../../components/canvas/builders/LoopBuilder.js'
import { ParamDrawer } from '../../components/canvas/ParamDrawer.js'
import { NodeOutputPanel } from '../../components/canvas/NodeOutputPanel.js'
import { ExecutionSettings } from './ExecutionSettings.js'

/** Right-hand inspector for the selected graph node: builders, params, execution settings, output. */
export function NodeInspector({
  selected,
  edges,
  setParam,
}: {
  selected: Node<GraphNodeData>
  edges: Edge[]
  setParam: (nodeId: string, key: string, value: unknown) => void
}): JSX.Element {
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto scrollbar-sleek border-l border-border bg-card/40">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-[13px] font-medium">
        {selected.data.label}
      </div>
      {selected.data.kind === 'if' && (
        <IfConditionBuilder
          value={selected.data.params}
          onChange={(key, value) => setParam(selected.id, key, value)}
        />
      )}
      {selected.data.kind === 'loop' && (
        <LoopBuilder
          value={selected.data.params}
          onChange={(key, value) => setParam(selected.id, key, value)}
        />
      )}
      <ParamDrawer
        params={selected.data.availableParams.filter((p) =>
          selected.data.kind === 'if'
            ? p.name !== 'expression'
            : selected.data.kind === 'loop'
              ? p.name !== 'source'
              : true,
        )}
        values={selected.data.params}
        chips={[
          '{{ target.value }}',
          ...edges
            .filter((e) => e.target === selected.id)
            .map((e) => `{{ nodes.${e.source}.output }}`),
        ]}
        onChange={(key, value) => setParam(selected.id, key, value)}
      />
      <ExecutionSettings
        timeoutMs={selected.data.params.__timeout_ms}
        onFailure={selected.data.params.__on_failure}
        noSave={selected.data.params.__no_save}
        onChange={(key, value) => setParam(selected.id, key, value)}
      />
      <NodeOutputPanel output={selected.data.output} />
    </div>
  )
}
