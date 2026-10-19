import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { Argv, NodeListing } from '../api/nodes.js'
import type { EngineEvent } from '../lib/events.js'
import type { TargetSummary } from '../api/targets.js'
import type { BackendProfile } from '../api/backends.js'
import type { NodeOutputRow, StandaloneRun } from '../api/executions.js'
import type { ToolProbeBatchResponse, ToolProbeResult } from '../api/tools.js'

const node = (over: Partial<NodeListing> = {}): NodeListing => ({
  id: 'nmap',
  name: 'Nmap',
  category: 'recon',
  description: 'port scan',
  accepts: ['domain', 'ip'],
  params: { ports: { type: 'string', default: '1-1000' } },
  program: 'nmap',
  ...over,
})

const backend = (over: Partial<BackendProfile> = {}): BackendProfile => ({
  id: 'be-1',
  name: 'kali',
  kind: 'ssh',
  host: 'kali.lan',
  user: 'root',
  createdAt: '',
  updatedAt: '',
  ...over,
})

const NODES = [node(), node({ id: 'whois', name: 'Whois', program: 'whois', accepts: ['domain'] })]
const TARGETS: TargetSummary[] = [
  { id: 't1', kind: 'domain', value: 'example.com' },
  { id: 't2', kind: 'url', value: 'https://example.com/a' },
]

const nodes = {
  list: vi.fn(() => Promise.resolve(NODES)),
  run: vi.fn(() => Promise.resolve({ executionId: 'ex-1' })),
  preview: vi.fn(
    (_id: string, body: { targetId?: string; params: Record<string, unknown> }): Promise<Argv> =>
      Promise.resolve({ program: 'nmap', args: ['-p', '1-1000', body.targetId === undefined ? '<target>' : 'example.com'] }),
  ),
}
const targets = {
  list: vi.fn(() => Promise.resolve(TARGETS)),
  create: vi.fn((input: { kind: string; value: string }) => Promise.resolve({ id: 't-new', ...input })),
}
const backends = { list: vi.fn(() => Promise.resolve([] as BackendProfile[])) }
const executions = {
  standalone: vi.fn(() => Promise.resolve([] as StandaloneRun[])),
  cancel: vi.fn(() => Promise.resolve({ ok: true, status: 'cancelled' })),
  output: vi.fn(() => Promise.resolve([] as NodeOutputRow[])),
}
const tools = {
  list: vi.fn(() =>
    Promise.resolve({
      platform: 'linux',
      tools: [
        { program: 'nmap', usedBy: ['Nmap'], install: { linux: 'sudo apt install -y nmap' } },
        { program: 'whois', usedBy: ['Whois'], install: { linux: 'sudo apt install -y whois' } },
      ],
    }),
  ),
  probeBatch: vi.fn(
    (programs: string[], backendId?: string): Promise<ToolProbeBatchResponse> =>
      Promise.resolve({
        backendId: backendId ?? 'local',
        results: programs.map((program): ToolProbeResult => ({ program, installed: true, version: null })),
      }),
  ),
}

vi.mock('../api/nodes.js', () => ({ nodesApi: () => nodes }))
vi.mock('../api/targets.js', () => ({ targetsApi: () => targets }))
vi.mock('../api/backends.js', () => ({ backendsApi: () => backends }))
vi.mock('../api/executions.js', () => ({ executionsApi: () => executions }))
vi.mock('../api/tools.js', () => ({ toolsApi: () => tools }))
/** What the engine's event stream holds; a test sets it before rendering. */
let streamed: { type: string; executionId: string; nodeId: string; data: string }[] = []

/** Feed events to the tools store as the engine subscription would. */
function emit(events: typeof streamed): void {
  useToolsStore.getState().ingest(
    '',
    events.map((e, i) => ({ ...e, type: e.type as EngineEvent['type'], seq: i, at: '' })),
  )
}

// Radix's Select needs pointer APIs jsdom does not implement, so the connection
// picker stands in as a native select — same contract, drivable in a test.
vi.mock('../components/ui/select.js', () => ({
  Select: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string
    onValueChange: (v: string) => void
    options: { value: string; label: string }[]
    ariaLabel?: string
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

// jsdom lays nothing out, so it has no scrollIntoView; the output pane calls it
// to follow the stream.
Element.prototype.scrollIntoView = vi.fn()

const { ToolsView } = await import('./ToolsView.js')
const { useToolsStore, resetToolsStore } = await import('./tools/tools-store.js')

/** Probe results keyed by program, for a connection where some are missing. */
function probeWith(installed: Record<string, boolean>): void {
  tools.probeBatch.mockImplementation(
    (programs: string[], backendId?: string): Promise<ToolProbeBatchResponse> =>
      Promise.resolve({
        backendId: backendId ?? 'local',
        results: programs.map((program) => ({ program, installed: installed[program] ?? true, version: null })),
      }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  nodes.list.mockResolvedValue(NODES)
  nodes.run.mockResolvedValue({ executionId: 'ex-1' })
  nodes.preview.mockImplementation((_id, body) =>
    Promise.resolve({ program: 'nmap', args: ['-p', '1-1000', body.targetId === undefined ? '<target>' : 'example.com'] }),
  )
  targets.list.mockResolvedValue(TARGETS)
  backends.list.mockResolvedValue([])
  executions.standalone.mockResolvedValue([])
  executions.output.mockResolvedValue([])
  probeWith({})
  streamed = []
  resetToolsStore()
  useApp.setState({ client: {} as AxiosInstance, connection: null, pendingToolTargetId: null })
})

/** Render and wait for the catalog to arrive. */
async function open(): Promise<void> {
  emit(streamed)
  streamed = []
  render(<ToolsView />)
  await screen.findByRole('button', { name: 'Nmap' })
}

/** A recent standalone run, as the engine lists it. */
const pastRun = (over: Partial<StandaloneRun> = {}): StandaloneRun => ({
  id: 'ex-0',
  nodeId: 'nmap',
  targetId: 't1',
  targetValue: 'example.com',
  status: 'succeeded',
  backend: 'local',
  backendProfileId: null,
  startedAt: null,
  finishedAt: null,
  exitCode: 0,
  params: {},
  ...over,
})

/** One node's saved output, as GET /executions/:id/output returns it. */
const outputRow = (over: Partial<NodeOutputRow> = {}): NodeOutputRow => ({
  nodeId: 'nmap',
  status: 'succeeded',
  exitCode: 0,
  stdout: 'raw nmap text',
  stderr: '',
  parsed: [
    { host: 'a.example.com', port: 443 },
    { host: 'b.example.com', port: 80 },
  ],
  ...over,
})

/** Pick a tool from the catalog, then a target from its list. */
async function pick(tool: string, target: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: tool }))
  const list = await screen.findByRole('listbox', { name: 'Target' })
  fireEvent.click(within(list).getByRole('option', { name: target }))
}

describe('ToolsView', () => {
  it('lists the catalog and runs nothing until a tool is picked', async () => {
    await open()
    expect(screen.getByText('Pick a tool to run.')).toBeTruthy()
  })

  it('shows param examples in the fields and no template chips', async () => {
    nodes.list.mockResolvedValue([
      node({ params: { ports: { type: 'string', default: '', placeholder: '80,443' } } }),
    ])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    const ports = await screen.findByLabelText('ports')
    expect(ports.getAttribute('placeholder')).toBe('80,443')
    expect(screen.queryByText('{{ target.value }}')).toBeNull()
  })

  it('resizes the output pane from its handle and remembers the size', async () => {
    localStorage.removeItem('exe.toolsOutputSize')
    await open()
    const handle = screen.getByRole('separator', { name: 'Resize output' })
    const pane = handle.parentElement!
    expect(pane.style.getPropertyValue('--output-h')).toBe('480px')

    // Stacked layout (jsdom has no wide viewport): up grows the pane's height.
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(pane.style.getPropertyValue('--output-h')).toBe('496px')
    expect(JSON.parse(localStorage.getItem('exe.toolsOutputSize')!)).toMatchObject({ height: 496 })

    fireEvent.doubleClick(handle)
    expect(pane.style.getPropertyValue('--output-h')).toBe('480px')
  })

  it('filters the catalog by search text', async () => {
    await open()
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'whois' } })
    expect(screen.queryByRole('button', { name: 'Nmap' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Whois' })).toBeTruthy()
  })

  it('offers only targets of a kind the tool accepts', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    // Nmap accepts domain and ip; the url target is not offered.
    const list = await screen.findByRole('listbox', { name: 'Target' })
    expect(within(list).getByRole('option', { name: /example\.com/ })).toBeTruthy()
    expect(within(list).queryByRole('option', { name: /https:/ })).toBeNull()
  })

  it('drops the target when a newly picked tool does not accept its kind', async () => {
    nodes.list.mockResolvedValue([...NODES, node({ id: 'httpx', name: 'Httpx', program: 'httpx', accepts: ['url'] })])
    await open()
    await pick('Nmap', /example\.com/)
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Httpx' }))
    // A domain cannot go to a url-only tool; keeping it would only earn a 400.
    expect(await screen.findByText('Pick a target to run against.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows only the output of the run it started', async () => {
    streamed = [
      { type: 'stdout', executionId: 'ex-1', nodeId: 'nmap', data: 'mine\n' },
      { type: 'stdout', executionId: 'ex-other', nodeId: 'nmap', data: 'a workflow alongside\n' },
    ]
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText(/mine/)).toBeTruthy()
    expect(screen.queryByText(/a workflow alongside/)).toBeNull()
  })

  it('arrives from the Targets page with that target already picked', async () => {
    useApp.setState({ pendingToolTargetId: 't1' })
    await open()
    expect(screen.getByText('Pick a tool to run against example.com.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))
    await waitFor(() => expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't1', params: {} }))
    // Consumed once, so coming back to the page later starts clean.
    expect(useApp.getState().pendingToolTargetId).toBeNull()
  })

  it('runs the selected tool against the selected target on this machine', async () => {
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(nodes.run).toHaveBeenCalledTimes(1))
    expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't1', params: {} })
  })

  it('names the connection on the run when one is chosen', async () => {
    backends.list.mockResolvedValue([backend()])
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(nodes.run).toHaveBeenCalledTimes(1))
    expect(nodes.run).toHaveBeenCalledWith('nmap', {
      targetId: 't1',
      params: {},
      backendProfileId: 'be-1',
    })
  })

  it('probes each connection once and caches the result', async () => {
    backends.list.mockResolvedValue([backend()])
    await open()
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    const picker = await screen.findByRole('combobox', { name: 'Connection' })

    fireEvent.change(picker, { target: { value: 'be-1' } })
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(2))

    // Back to this machine, then out to kali again: both already known.
    fireEvent.change(picker, { target: { value: 'local' } })
    fireEvent.change(picker, { target: { value: 'be-1' } })
    expect(tools.probeBatch).toHaveBeenCalledTimes(2)
  })

  it('offers Install instead of Run when the tool is missing on the connection', async () => {
    probeWith({ nmap: false })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))

    expect(await screen.findByRole('button', { name: /Install nmap/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.getByText('nmap is not installed on this connection.')).toBeTruthy()
  })

  it('opens the install commands for a tool missing on this machine', async () => {
    probeWith({ nmap: false })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    fireEvent.click(await screen.findByRole('button', { name: /Install nmap/ }))

    expect(await screen.findByText('sudo apt install -y nmap')).toBeTruthy()
    // Once in the Run footer, once in the dialog saying where it installs.
    expect(screen.getAllByText('on this machine')).toHaveLength(2)
  })

  it('treats an unreachable connection as unknown, never as missing', async () => {
    backends.list.mockResolvedValue([backend()])
    tools.probeBatch.mockImplementation((programs: string[], backendId?: string) =>
      Promise.resolve(
        backendId === undefined
          ? {
              backendId: 'local',
              results: programs.map((program) => ({ program, installed: true, version: null })),
            }
          : { backendId, results: [], error: 'No route to host' },
      ),
    )
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Connection' }), {
      target: { value: 'be-1' },
    })

    expect(await screen.findByText(/install state is unknown/)).toBeTruthy()
    // Not blocked: the connection may recover, and the run's own failure is a
    // truer report than a stale probe.
    expect(screen.queryByRole('button', { name: /Install/ })).toBeNull()
  })

  it('seeds a tool with the params it was last run with', async () => {
    executions.standalone.mockResolvedValue([
      {
        id: 'ex-0',
        nodeId: 'nmap',
        targetId: 't1',
        targetValue: 'example.com',
        status: 'succeeded',
        backend: 'local',
        backendProfileId: null,
        startedAt: null,
        finishedAt: null,
        exitCode: 0,
        params: { ports: '22,443' },
      },
    ])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect(await screen.findByDisplayValue('22,443')).toBeTruthy()
  })

  it('says where seeded params came from and resets them to the defaults', async () => {
    executions.standalone.mockResolvedValue([pastRun({ params: { ports: '22,443' } })])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect(await screen.findByText('Filled in from your last run of this tool.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/ }))
    expect((screen.getByLabelText('ports') as HTMLInputElement).value).toBe('1-1000')
    expect(screen.queryByRole('button', { name: /Reset to defaults/ })).toBeNull()
  })

  it('offers a reset once a param is edited', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect(screen.queryByRole('button', { name: /Reset to defaults/ })).toBeNull()
    fireEvent.change(await screen.findByLabelText('ports'), { target: { value: '80' } })
    expect(screen.getByText('Changed from the defaults.')).toBeTruthy()
  })

  it('will not run until every required field is filled in', async () => {
    nodes.list.mockResolvedValue([
      node({ params: { query: { type: 'string', required: true, label: 'Query' } } }),
    ])
    await open()
    await pick('Nmap', /example\.com/)
    expect(screen.getByText('Fill in Query to run.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('query'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('query'), { target: { value: 'apache 2.4' } })
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(false)
  })

  it('previews the command a run would execute, with the picked target filled in', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect((await screen.findByLabelText('Command')).textContent).toBe('$ nmap -p 1-1000 <target>')

    const list = await screen.findByRole('listbox', { name: 'Target' })
    fireEvent.click(within(list).getByRole('option', { name: /example\.com/ }))
    await waitFor(() => expect(screen.getByLabelText('Command').textContent).toBe('$ nmap -p 1-1000 example.com'))
    expect(nodes.preview).toHaveBeenLastCalledWith('nmap', { params: {}, targetId: 't1' })
  })

  it('says why the command cannot be built yet', async () => {
    nodes.preview.mockRejectedValue({ response: { data: { error: 'param "userlist" is required' } } })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect(await screen.findByText('Command not ready: param "userlist" is required')).toBeTruthy()
  })

  it('shows why a run did not start instead of failing silently', async () => {
    nodes.run.mockRejectedValue({ response: { data: { error: 'node nmap does not accept url' } } })
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect((await screen.findByRole('alert')).textContent).toBe('node nmap does not accept url')
  })

  it('runs once per picked target', async () => {
    targets.list.mockResolvedValue([...TARGETS, { id: 't3', kind: 'domain', value: 'other.org' }])
    nodes.run.mockResolvedValueOnce({ executionId: 'ex-1' }).mockResolvedValueOnce({ executionId: 'ex-2' })
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Target' })).getByRole('option', { name: /other\.org/ }))

    expect(await screen.findByText('and 1 more target')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run on 2 targets' }))
    await waitFor(() => expect(nodes.run).toHaveBeenCalledTimes(2))
    expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't1', params: {} })
    expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't3', params: {} })
  })

  it('selects every target the search shows, and clears them', async () => {
    targets.list.mockResolvedValue([...TARGETS, { id: 't3', kind: 'domain', value: 'other.org' }])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select all' }))
    expect(screen.getByRole('button', { name: 'Run on 2 targets' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Pick a target to run against.')).toBeTruthy()
  })

  it('says how many of a batch did not start', async () => {
    targets.list.mockResolvedValue([...TARGETS, { id: 't3', kind: 'domain', value: 'other.org' }])
    nodes.run
      .mockResolvedValueOnce({ executionId: 'ex-1' })
      .mockRejectedValueOnce({ response: { data: { error: 'unknown target' } } })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run on 2 targets' }))
    expect((await screen.findByRole('alert')).textContent).toBe('1 of 2 runs did not start: unknown target')
  })

  it('settles a run in the history that is not the one being watched', async () => {
    executions.standalone.mockResolvedValue([pastRun({ id: 'ex-bg', status: 'running' })])
    streamed = [{ type: 'done', executionId: 'ex-bg', nodeId: 'nmap', data: 'succeeded' }]
    await open()
    await waitFor(() => expect(executions.standalone).toHaveBeenCalledTimes(2))
    // The engine still says running (it lags the event): ask once, not forever.
    await new Promise((r) => setTimeout(r, 50))
    expect(executions.standalone).toHaveBeenCalledTimes(2)
  })

  it('marks the watched run in the history', async () => {
    executions.standalone.mockResolvedValue([pastRun()])
    await open()
    const entry = await screen.findByRole('button', { name: 'Load Nmap run against example.com' })
    expect(entry.getAttribute('aria-current')).toBeNull()
    fireEvent.click(entry)
    expect(entry.getAttribute('aria-current')).toBe('true')
  })

  it('runs on Ctrl+Enter, but only when Run is offered', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    await screen.findByRole('listbox', { name: 'Target' })
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(nodes.run).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Target' })).getByRole('option', { name: /example\.com/ }))
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(nodes.run).toHaveBeenCalledTimes(1))
  })

  it('jumps to tool search on "/" unless typing in a field', async () => {
    await open()
    const search = screen.getByRole('searchbox', { name: /search tools/i })
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)

    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    const ports = await screen.findByLabelText('ports')
    ports.focus()
    fireEvent.keyDown(ports, { key: '/' })
    expect(document.activeElement).toBe(ports)
  })

  it('walks the catalog with the arrow keys, picking each tool', async () => {
    await open()
    const search = screen.getByRole('searchbox', { name: /search tools/i })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const first = screen.getByRole('button', { name: 'Nmap' })
    expect(document.activeElement).toBe(first)
    expect(first.getAttribute('aria-current')).toBe('true')

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Whois' }))
    expect(screen.getByRole('button', { name: 'Whois' }).getAttribute('aria-current')).toBe('true')
  })

  it('hides tools missing on the connection when asked to', async () => {
    probeWith({ nmap: false })
    await open()
    expect(await screen.findByText('1 missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Installed only/ }))
    expect(screen.queryByRole('button', { name: 'Nmap' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Whois' })).toBeTruthy()
    expect(screen.getByText('1 hidden')).toBeTruthy()
  })

  it("narrows the history to the picked tool's runs, with all a click away", async () => {
    executions.standalone.mockResolvedValue([pastRun(), pastRun({ id: 'ex-w', nodeId: 'whois' })])
    await open()
    expect(await screen.findByRole('button', { name: 'Load Whois run against example.com' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    expect(screen.queryByRole('button', { name: 'Load Whois run against example.com' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Runs of Nmap' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'All runs' }))
    expect(screen.getByRole('button', { name: 'Load Whois run against example.com' })).toBeTruthy()
  })

  it('adds a target from the form and picks it, when the tool has none to take', async () => {
    nodes.list.mockResolvedValue([node({ accepts: ['cidr'] })])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    const field = await screen.findByRole('textbox', { name: 'New target' })
    expect(field.getAttribute('placeholder')).toBe('10.0.0.0/24')

    targets.list.mockResolvedValue([...TARGETS, { id: 't-new', kind: 'cidr', value: '10.0.0.0/24' }])
    fireEvent.change(field, { target: { value: '10.0.0.0/24' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() =>
      expect(targets.create).toHaveBeenCalledWith({ kind: 'cidr', value: '10.0.0.0/24', source: 'manual' }),
    )
    const option = await screen.findByRole('option', { name: /10\.0\.0\.0\/24/ })
    expect(option.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(false)
  })

  it('refuses a new target of a kind the tool cannot take', async () => {
    nodes.list.mockResolvedValue([node({ accepts: ['cidr'] })])
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    const field = await screen.findByRole('textbox', { name: 'New target' })
    fireEvent.change(field, { target: { value: 'example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nmap takes cidr targets, and this looks like a domain.')
    expect(targets.create).not.toHaveBeenCalled()
  })

  it('shows the engine refusal for a target it will not store', async () => {
    targets.create.mockRejectedValueOnce({ response: { data: { error: 'wildcards are not targets' } } })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Nmap' }))
    await screen.findByRole('listbox', { name: 'Target' })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    const field = screen.getByRole('textbox', { name: 'New target' })
    fireEvent.change(field, { target: { value: 'other.org' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('wildcards are not targets')
  })

  it('says which connection Run sends to', async () => {
    backends.list.mockResolvedValue([backend()])
    await open()
    await pick('Nmap', /example\.com/)
    expect(screen.getByText('on this machine')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-1' } })
    expect(screen.getByText('on kali')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() =>
      expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't1', params: {}, backendProfileId: 'be-1' }),
    )
  })

  it('names the connection a past run used', async () => {
    backends.list.mockResolvedValue([backend()])
    executions.standalone.mockResolvedValue([pastRun({ backend: 'ssh', backendProfileId: 'be-1' })])
    await open()
    expect(await screen.findByText('example.com · kali')).toBeTruthy()
  })

  it('restores a remote run saved without its profile id to the one connection of its kind', async () => {
    backends.list.mockResolvedValue([backend()])
    // Saved before runs kept their profile id: only the kind survives.
    executions.standalone.mockResolvedValue([pastRun({ backend: 'ssh', backendProfileId: null })])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))

    expect((screen.getByRole('combobox', { name: 'Connection' }) as HTMLSelectElement).value).toBe('be-1')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() =>
      expect(nodes.run).toHaveBeenCalledWith('nmap', { targetId: 't1', params: {}, backendProfileId: 'be-1' }),
    )
  })

  it('never moves a remote run to this machine when its connection cannot be found', async () => {
    backends.list.mockResolvedValue([backend(), backend({ id: 'be-2', name: 'vps' })])
    executions.standalone.mockResolvedValue([pastRun({ backend: 'ssh', backendProfileId: 'be-gone' })])
    await open()
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-2' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))

    expect((screen.getByRole('combobox', { name: 'Connection' }) as HTMLSelectElement).value).toBe('be-2')
    expect(screen.getByText('The ssh connection this run used is gone, so pick where to run it.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-1' } })
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(false)
  })

  it('finds the page as it was left after switching views', async () => {
    backends.list.mockResolvedValue([backend()])
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-1' } })
    fireEvent.change(screen.getByLabelText('ports'), { target: { value: '22' } })
    cleanup()

    await open()
    expect(screen.getByRole('button', { name: 'Nmap' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('option', { name: /example\.com/ }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('combobox', { name: 'Connection' }) as HTMLSelectElement).value).toBe('be-1')
    expect((screen.getByLabelText('ports') as HTMLInputElement).value).toBe('22')
  })

  it('keeps a run going while away, with the output it printed meanwhile', async () => {
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(nodes.run).toHaveBeenCalled())
    await screen.findByText('Waiting for output…')
    cleanup()

    // Printed while another view was showing.
    emit([{ type: 'stdout', executionId: 'ex-1', nodeId: 'nmap', data: 'port 22 open\n' }])
    await open()
    expect(screen.getByText(/port 22 open/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeTruthy()
  })

  it('shows the result of a run that finished while away', async () => {
    executions.output.mockResolvedValue([outputRow()])
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await screen.findByText('Waiting for output…')
    cleanup()

    emit([{ type: 'done', executionId: 'ex-1', nodeId: 'nmap', data: 'succeeded' }])
    await open()
    expect(await screen.findByRole('cell', { name: 'a.example.com' })).toBeTruthy()
    expect(screen.getByText('succeeded')).toBeTruthy()
  })

  it('settles a watched run from the history when its end was never heard', async () => {
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await screen.findByText('Waiting for output…')
    cleanup()

    // No done event reached the page (the engine restarted, say), but the
    // history knows how the run ended.
    executions.standalone.mockResolvedValue([pastRun({ id: 'ex-1', status: 'failed' })])
    await open()
    expect(await screen.findByText('failed')).toBeTruthy()
  })

  it('keeps what it learned about installed tools across view switches', async () => {
    probeWith({ nmap: false })
    await open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: missing'))
    cleanup()

    await open()
    expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: missing')
    expect(screen.getByRole('button', { name: 'Whois' }).title).toBe('Whois: installed')
    expect(tools.probeBatch).toHaveBeenCalledTimes(1)
  })

  it('asks the connection again on Recheck', async () => {
    probeWith({ nmap: false })
    await open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: missing'))

    probeWith({})
    fireEvent.click(screen.getByRole('button', { name: 'Recheck installed tools' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: installed'))
    expect(tools.probeBatch).toHaveBeenCalledTimes(2)
  })

  it('tries a connection it could not reach again when the page opens', async () => {
    tools.probeBatch.mockRejectedValueOnce(new Error('down'))
    await open()
    expect(await screen.findByText(/install state is unknown/)).toBeTruthy()
    cleanup()

    await open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: installed'))
    expect(tools.probeBatch).toHaveBeenCalledTimes(2)
  })

  it('shows when each recent run started and how long it took', async () => {
    const started = new Date(Date.now() - 5 * 60_000)
    executions.standalone.mockResolvedValue([
      pastRun({ startedAt: started.toISOString(), finishedAt: new Date(started.getTime() + 41_000).toISOString() }),
    ])
    await open()
    expect(await screen.findByText('5m ago · 41s')).toBeTruthy()
  })

  it('reloads a recent run whole when it is clicked', async () => {
    executions.standalone.mockResolvedValue([
      {
        id: 'ex-0',
        nodeId: 'whois',
        targetId: 't1',
        targetValue: 'example.com',
        status: 'succeeded',
        backend: 'local',
        backendProfileId: null,
        startedAt: null,
        finishedAt: null,
        exitCode: 0,
        params: { ports: '8080' },
      },
    ])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Whois run against example.com' }))

    expect(await screen.findByDisplayValue('8080')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Whois' })).toBeTruthy()
  })

  it('resets the connection to this machine when a run names a deleted one', async () => {
    executions.standalone.mockResolvedValue([
      {
        id: 'ex-0',
        nodeId: 'nmap',
        targetId: 't1',
        targetValue: 'example.com',
        status: 'succeeded',
        backend: 'ssh',
        backendProfileId: 'be-gone',
        startedAt: null,
        finishedAt: null,
        exitCode: 0,
        params: {},
      },
    ])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))
    // No profiles exist, so the ssh connection it ran on is gone.
    const picker = await screen.findByRole('combobox', { name: 'Connection' })
    expect((picker as HTMLSelectElement).value).toBe('local')
  })

  it('reloads the exact connection a run used, not another of the same kind', async () => {
    backends.list.mockResolvedValue([backend({ id: 'be-1', name: 'kali' }), backend({ id: 'be-2', name: 'parrot' })])
    executions.standalone.mockResolvedValue([
      {
        id: 'ex-0',
        nodeId: 'nmap',
        targetId: 't1',
        targetValue: 'example.com',
        status: 'succeeded',
        backend: 'ssh',
        backendProfileId: 'be-2',
        startedAt: null,
        finishedAt: null,
        exitCode: 0,
        params: {},
      },
    ])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))
    const picker = await screen.findByRole('combobox', { name: 'Connection' })
    await waitFor(() => expect((picker as HTMLSelectElement).value).toBe('be-2'))
  })

  it('does not swap a deleted connection for another of the same kind', async () => {
    backends.list.mockResolvedValue([backend({ id: 'be-1', name: 'kali' })])
    executions.standalone.mockResolvedValue([
      {
        id: 'ex-0',
        nodeId: 'nmap',
        targetId: 't1',
        targetValue: 'example.com',
        status: 'succeeded',
        backend: 'ssh',
        backendProfileId: 'be-gone',
        startedAt: null,
        finishedAt: null,
        exitCode: 0,
        params: {},
      },
    ])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))
    const picker = await screen.findByRole('combobox', { name: 'Connection' })
    // The run named its box and that box is gone: kali is a different machine,
    // and this machine is not where it ran either. The user picks.
    expect((picker as HTMLSelectElement).value).toBe('local')
    expect(screen.getByText('The ssh connection this run used is gone, so pick where to run it.')).toBeTruthy()
  })

  it('picks the connection in the page header, before any tool is chosen', async () => {
    backends.list.mockResolvedValue([backend()])
    await open()
    const header = screen.getByRole('toolbar', { name: 'Tools' })
    expect(within(header).getByRole('combobox', { name: 'Connection' })).toBeTruthy()

    // The run form no longer carries a picker of its own.
    await pick('Nmap', /example\.com/)
    expect(screen.getAllByRole('combobox', { name: 'Connection' })).toHaveLength(1)
  })

  it('marks the catalog with what is installed on the header connection', async () => {
    backends.list.mockResolvedValue([backend()])
    tools.probeBatch.mockImplementation((programs: string[], backendId?: string) =>
      Promise.resolve({
        backendId: backendId ?? 'local',
        results: programs.map((program) => ({
          program,
          installed: backendId === undefined || program !== 'nmap',
          version: null,
        })),
      }),
    )
    await open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: installed'))

    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), { target: { value: 'be-1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nmap' }).title).toBe('Nmap: missing'))
    expect(tools.probeBatch).toHaveBeenLastCalledWith(['nmap', 'whois'], 'be-1')
  })

  it('shows the parsed rows as a table once the run finishes', async () => {
    streamed = [
      { type: 'stdout', executionId: 'ex-1', nodeId: 'nmap', data: 'raw nmap text' },
      { type: 'done', executionId: 'ex-1', nodeId: 'nmap', data: 'succeeded' },
    ]
    executions.output.mockResolvedValue([outputRow()])
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByRole('cell', { name: 'a.example.com' })).toBeTruthy()
    expect(executions.output).toHaveBeenCalledWith('ex-1')
    expect(screen.getByRole('tab', { name: /parsed/ }).getAttribute('aria-selected')).toBe('true')
    // The raw streams stay one click away.
    fireEvent.click(screen.getByRole('tab', { name: /stdout/ }))
    expect(screen.getByText('raw nmap text')).toBeTruthy()
  })

  it('opens a failed run on stderr, where the reason is', async () => {
    streamed = [{ type: 'done', executionId: 'ex-1', nodeId: 'nmap', data: 'failed' }]
    executions.output.mockResolvedValue([
      outputRow({ status: 'failed', exitCode: 1, stderr: 'nmap: permission denied', parsed: [] }),
    ])
    await open()
    await pick('Nmap', /example\.com/)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText('nmap: permission denied')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /stderr/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens on stdout when the run parsed no rows', async () => {
    executions.standalone.mockResolvedValue([pastRun()])
    executions.output.mockResolvedValue([outputRow({ parsed: null })])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))

    expect(await screen.findByText('raw nmap text')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /parsed/ }))
    expect(screen.getByText('This run parsed no rows.')).toBeTruthy()
  })

  it("shows a recent run's saved output when it is clicked", async () => {
    executions.standalone.mockResolvedValue([pastRun()])
    executions.output.mockResolvedValue([outputRow()])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))

    expect(await screen.findByRole('cell', { name: 'a.example.com' })).toBeTruthy()
    expect(executions.output).toHaveBeenCalledWith('ex-0')
  })

  it('opens the full output dialog from the pane', async () => {
    executions.standalone.mockResolvedValue([pastRun()])
    executions.output.mockResolvedValue([outputRow()])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Load Nmap run against example.com' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Expand output' }))

    expect(await screen.findByRole('dialog', { name: 'nmap output' })).toBeTruthy()
  })
})
