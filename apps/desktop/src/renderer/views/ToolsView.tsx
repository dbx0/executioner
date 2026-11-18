import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody } from '../components/ui/page.js'
import { InstallModal } from './settings/tools/InstallModal.js'
import { NodeOutputModal } from './executions/NodeOutputModal.js'
import { CatalogPane } from './tools/CatalogPane.js'
import { LOCAL } from './tools/ConnectionPicker.js'
import { OutputPane } from './tools/OutputPane.js'
import { RunForm } from './tools/RunForm.js'
import { ToolPanelTabs } from './tools/ToolPanelTabs.js'
import { ToolsToolbar } from './tools/ToolsToolbar.js'
import { presetsFor, readPresets, withPreset, withoutPreset, writePresets, type PresetBook } from './tools/presets.js'
import type { ToolTab } from './tools/tools-store.js'
import { useCommandPreview } from './tools/use-command-preview.js'
import { useInstallState } from './tools/use-install-state.js'
import { useToolRuns } from './tools/use-tool-runs.js'
import { useToolSelection } from './tools/use-tool-selection.js'
import { useToolsData } from './tools/use-tools-data.js'
import { useToolsPage } from './tools/use-tools-page.js'
import { useToolsShortcuts } from './tools/use-tools-shortcuts.js'

/**
 * Tools: run one tool against one target or several, on any connection,
 * without building a workflow first.
 *
 * A run here is an ordinary execution: it shows up in Runs, it emits targets
 * and facts, and it stops when told to. What this page adds is the shortest
 * path to starting one: a catalog that knows what is installed where, a form
 * that remembers how you last ran each tool, and the output in the same view.
 *
 * The page itself only wires its pieces together; each concern (kept state,
 * loading, install status, selection, runs) is a hook under `./tools/`.
 */
export function ToolsView(): JSX.Element {
  const client = useApp((s) => s.client)
  const connection = useApp((s) => s.connection) ?? undefined

  const data = useToolsData(client)
  const { nodes, targets, profiles, catalog, recent, platform } = data
  const state = useToolsPage(connection)
  const { root, live, setTargetIds, setParams, setParamsOrigin, setBackendId, setConnectionNote, setTabFor } = state
  const { query, nodeId, targetIds, backendId, params, paramsOrigin, connectionNote, tabs } = state.page

  // Why the last Run did not start, until the form changes.
  const [startError, setStartError] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // A deep link from a target's right-click menu: start with that target
  // picked. Consumed once, like the other pending-id links. Picking a tool that
  // cannot take its kind still drops it, exactly as if it had been clicked here.
  const pendingToolTargetId = useApp((s) => s.pendingToolTargetId)
  const setPendingToolTargetId = useApp((s) => s.setPendingToolTargetId)
  useEffect(() => {
    if (pendingToolTargetId === null) return
    setTargetIds([pendingToolTargetId])
    setTabFor(nodeId, 'run')
    setPendingToolTargetId(null)
  }, [pendingToolTargetId, setPendingToolTargetId, setTargetIds, setTabFor, nodeId])

  const node = useMemo(() => nodes.find((n) => n.id === nodeId) ?? null, [nodes, nodeId])

  // Saved param sets, read once and written through on every change.
  const [presetBook, setPresetBook] = useState<PresetBook>(() => readPresets())
  const presets = useMemo(() => (nodeId === null ? [] : presetsFor(presetBook, root, nodeId)), [presetBook, root, nodeId])
  const changePresets = useCallback((next: PresetBook) => {
    setPresetBook(next)
    writePresets(next)
  }, [])

  const install = useInstallState({ client, nodes, backendId, probes: state.probes, setProbes: state.setProbes })
  const { installState, recheck } = install
  const { selectNode, connectionLabel, replay, addTarget } = useToolSelection({ client, data, state, setStartError })
  const preview = useCommandPreview(client, node, targetIds, params)
  const runs = useToolRuns({ client, node, data, state, setStartError })
  const { searchRef, runRef } = useToolsShortcuts(expanded || installOpen)

  // The tools run lately here, newest first, for the catalog's Recent group.
  const recentToolIds = useMemo(() => {
    const ids: string[] = []
    for (const r of recent) {
      if (ids.length === 5) break
      if (!ids.includes(r.nodeId) && nodes.some((n) => n.id === r.nodeId)) ids.push(r.nodeId)
    }
    return ids
  }, [recent, nodes])

  const nodeName = useCallback((id: string) => nodes.find((n) => n.id === id)?.name ?? id, [nodes])

  if (client === null) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-xs text-muted-foreground">Open an engagement to run tools.</p>
      </div>
    )
  }

  const installTool = node?.program !== undefined ? catalog[node.program] : undefined
  // The connection Run sends to, by name, so it is never a surprise.
  const runsOn = backendId === LOCAL ? 'this machine' : (profiles.find((p) => p.id === backendId)?.name ?? 'this connection')
  // The Output tab exists once there is something to show for this tool (with
  // none picked, the whole history); until then the tool is just its settings.
  const outputShown = nodeId === null ? recent.length > 0 : live !== null || recent.some((r) => r.nodeId === nodeId)
  const activeTab = outputShown ? (tabs[nodeId ?? ''] ?? 'run') : 'run'
  const setTab = (next: ToolTab): void => setTabFor(nodeId, next)

  return (
    <Page>
      <ToolsToolbar
        count={nodes.length}
        install={install}
        profiles={profiles}
        backendId={backendId}
        onBackend={(id) => {
          setBackendId(id)
          setConnectionNote(null)
        }}
      />

      {/* The catalog beside the tool when there is room; narrower, the catalog
          sits above it and the whole view scrolls. */}
      <PageBody className="scrollbar-sleek flex-col overflow-y-auto min-[1100px]:flex-row min-[1100px]:overflow-hidden">
        <CatalogPane
          nodes={nodes}
          loading={data.loading}
          query={query}
          onQuery={state.setQuery}
          selectedId={nodeId}
          onSelect={selectNode}
          installState={installState}
          searchRef={searchRef}
          recentIds={recentToolIds}
          running={runs.runningTools}
        />
        <div className="flex min-h-[420px] min-w-0 flex-1 flex-col gap-panel min-[1100px]:min-h-0">
          {outputShown && <ToolPanelTabs active={activeTab} onSelect={setTab} liveStatus={live?.status ?? null} />}
          <GlassPanel
            id="tools-panel-run"
            role={outputShown ? 'tabpanel' : undefined}
            aria-labelledby={outputShown ? 'tools-tab-run' : undefined}
            hidden={activeTab !== 'run'}
            data-tour="tools-run"
            className={cn('min-h-0 flex-1 flex-col', activeTab === 'run' ? 'flex' : 'hidden')}
          >
            <RunForm
              node={node}
              targets={targets}
              targetIds={targetIds}
              onAddTarget={addTarget}
              onTargetIds={(ids) => {
                setTargetIds(ids)
                setStartError(null)
              }}
              params={params}
              onParam={(name, value) => {
                setParams((prev) => ({ ...prev, [name]: value }))
                setParamsOrigin('edited')
                setStartError(null)
              }}
              paramsOrigin={paramsOrigin}
              onResetParams={() => {
                setParams({})
                setParamsOrigin(null)
              }}
              presets={presets}
              onApplyPreset={(preset) => {
                setParams({ ...preset.params })
                setParamsOrigin('preset')
                setStartError(null)
              }}
              onSavePreset={(name) => {
                if (nodeId !== null) changePresets(withPreset(presetBook, root, nodeId, { name, params }))
              }}
              onDeletePreset={(name) => {
                if (nodeId !== null) changePresets(withoutPreset(presetBook, root, nodeId, name))
              }}
              installState={node === null ? 'unknown' : installState(node)}
              preview={preview}
              startError={startError}
              starting={runs.starting}
              onRun={runs.run}
              onInstall={() => setInstallOpen(true)}
              runRef={runRef}
              runsOn={runsOn}
              connectionNote={connectionNote}
            />
          </GlassPanel>
          {outputShown && (
            <GlassPanel
              tone="ink"
              id="tools-panel-output"
              role="tabpanel"
              aria-labelledby="tools-tab-output"
              hidden={activeTab !== 'output'}
              className={cn('min-h-0 flex-1 flex-col', activeTab === 'output' ? 'flex' : 'hidden')}
            >
              {/* Runs that did not start would otherwise be reported only on the
                  settings, out of sight once the panel turns to the output. */}
              {startError !== null && (
                <p role="alert" className="shrink-0 border-b border-glass-border px-3.5 py-2 text-[12px] text-status-error">
                  {startError}
                </p>
              )}
              <OutputPane
                live={live}
                lines={runs.lines}
                result={runs.result}
                onExpand={() => setExpanded(true)}
                now={runs.now}
                stopping={runs.stopping}
                onStop={runs.stop}
                recent={recent}
                selectedNodeId={nodeId}
                watchingId={live?.executionId ?? null}
                connectionLabel={connectionLabel}
                nodeName={nodeName}
                onReplay={replay}
                batch={runs.batchTabs}
                onShowRun={runs.showRun}
              />
            </GlassPanel>
          )}
        </div>
      </PageBody>

      {expanded && runs.rawResult != null && (
        <NodeOutputModal row={runs.rawResult} preferParsed subject="run" onClose={() => setExpanded(false)} />
      )}

      {installOpen && installTool !== undefined && (
        <InstallModal
          tool={installTool}
          // Only this machine's OS is known; a remote host's is not.
          platform={backendId === LOCAL ? platform : ''}
          where={runsOn}
          rechecking={install.probe?.busy ?? false}
          onClose={() => setInstallOpen(false)}
          onRecheck={() => {
            setInstallOpen(false)
            recheck()
          }}
        />
      )}
    </Page>
  )
}
