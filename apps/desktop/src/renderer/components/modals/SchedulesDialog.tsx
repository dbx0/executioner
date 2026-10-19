import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Clock, Sparkles, Trash2, Play, Pause } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import { schedulesApi, type Schedule, type ScheduleKind, type ScheduleInput } from '../../api/schedules.js'
import { workflowsApi, type WorkflowSummary } from '../../api/workflows.js'
import { targetsApi, type TargetSummary } from '../../api/targets.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Select } from '../ui/select.js'
import { cn } from '../../lib/utils.js'

const TARGET_KINDS = ['domain', 'subdomain', 'ip', 'cidr', 'url'] as const

function summary(s: Schedule, workflows: WorkflowSummary[], targets: TargetSummary[]): string {
  const wf = workflows.find((w) => w.id === s.workflowId)?.name ?? s.workflowId.slice(0, 8)
  if (s.kind === 'interval') {
    const target = s.targetId === null ? 'no target' : targets.find((t) => t.id === s.targetId)?.value ?? 'target'
    return `${wf} · every ${s.intervalSeconds ?? 0}s · ${target}`
  }
  return `${wf} · on new ${s.targetKind ?? '?'}`
}

export function SchedulesDialog({
  client,
  onClose,
}: {
  client: AxiosInstance
  onClose: () => void
}): JSX.Element {
  const api = schedulesApi(client)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])

  const [kind, setKind] = useState<ScheduleKind>('interval')
  const [workflowId, setWorkflowId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [intervalSeconds, setIntervalSeconds] = useState('3600')
  const [targetKind, setTargetKind] = useState<string>('domain')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void api.list().then(setSchedules).catch(() => {})
  }
  useEffect(() => {
    refresh()
    void workflowsApi(client).list().then(setWorkflows).catch(() => {})
    void targetsApi(client).list().then(setTargets).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const valid =
    workflowId !== '' &&
    (kind === 'interval' ? Number(intervalSeconds) > 0 : targetKind !== '')

  const save = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const body: ScheduleInput = { workflowId, kind }
      if (kind === 'interval') {
        body.intervalSeconds = Number(intervalSeconds)
        if (targetId !== '') body.targetId = targetId
      } else {
        body.targetKind = targetKind
      }
      await api.create(body)
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (s: Schedule): Promise<void> => {
    await api.setEnabled(s.id, !s.enabled).catch(() => {})
    refresh()
  }

  const remove = async (id: string): Promise<void> => {
    await api.remove(id).catch(() => {})
    refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[620px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[14px] font-medium">Schedules</div>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-4">
          <p className="mb-3 text-[12px] text-muted-foreground">
            Run a workflow automatically: on a recurring interval, or whenever a matching target is created.
          </p>

          {schedules.length === 0 ? (
            <p className="mb-4 text-xs text-muted-foreground">No schedules yet. Create one below.</p>
          ) : (
            <div className="mb-4 flex flex-col gap-1">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5',
                    !s.enabled && 'opacity-60',
                  )}
                >
                  {s.kind === 'interval' ? (
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px]">{summary(s, workflows, targets)}</span>
                  <button
                    type="button"
                    aria-label={s.enabled ? 'Disable' : 'Enable'}
                    onClick={() => void toggle(s)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {s.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => void remove(s.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-status-error" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-[13px] font-medium">New schedule</div>

            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Trigger</label>
            <div className="mb-3 flex gap-1">
              {(['interval', 'on_create'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs',
                    kind === k ? 'selected-surface border-transparent' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k === 'interval' ? <Clock className="size-3.5" /> : <Sparkles className="size-3.5" />}
                  {k === 'interval' ? 'Interval' : 'On create'}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Workflow</label>
            <Select
              className="mb-3"
              value={workflowId}
              onValueChange={(v) => setWorkflowId(v)}
              placeholder="Select a workflow…"
              options={workflows.map((w) => ({ value: w.id, label: w.name }))}
            />

            {kind === 'interval' ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Every (seconds)</label>
                  <Input
                    className="h-8"
                    type="number"
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(e.target.value)}
                    placeholder="3600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Target (optional)</label>
                  <Select
                    value={targetId}
                    onValueChange={(v) => setTargetId(v)}
                    placeholder="No target"
                    options={targets.map((t) => ({ value: t.id, label: `${t.value} (${t.kind})` }))}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">When this kind is created</label>
                <Select
                  value={targetKind}
                  onValueChange={(v) => setTargetKind(v)}
                  options={TARGET_KINDS.map((k) => ({ value: k, label: k }))}
                />
              </div>
            )}

            {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}

            <div className="mt-4 flex justify-end">
              <Button size="xs" disabled={!valid || busy} onClick={() => void save()}>
                Add schedule
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
