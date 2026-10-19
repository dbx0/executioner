import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingModal } from './OnboardingModal.js'
import { useApp } from '../../store.js'
import * as backends from '../../api/backends.js'

const connection = { projectRoot: '/tmp/probe', port: 1234, token: 't', pid: 1, version: '0.0.1' }

/** Stub the preload bridge. `openProject` resolves an engine handshake so the
 *  store mirrors a live client onto the wizard the way a real open does;
 *  `testBackend`/`enrollSsh` are how the connection step verifies with no
 *  engagement open at all. */
function stubBridge(
  over: { testBackend?: ReturnType<typeof vi.fn>; enrollSsh?: ReturnType<typeof vi.fn> } = {},
): { testBackend: ReturnType<typeof vi.fn>; enrollSsh: ReturnType<typeof vi.fn> } {
  const testBackend =
    over.testBackend ?? vi.fn().mockResolvedValue({ ok: true, steps: [{ name: 'Connect & run', ok: true }] })
  const enrollSsh = over.enrollSsh ?? vi.fn()
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      executioner: {
        pickFolder: vi.fn().mockResolvedValue('/tmp/probe'),
        openProject: vi.fn().mockResolvedValue(connection),
        checkAgents: vi.fn().mockResolvedValue([{ id: 'claude', installed: true }]),
        testBackend,
        enrollSsh,
        connectionHints: vi.fn().mockResolvedValue({
          sshHosts: [{ alias: 'kali-box', hostname: '10.0.0.5', user: 'root', port: 2222 }],
          sshKeys: ['/home/u/.ssh/id_ed25519'],
          defaultUser: 'bx0',
          dockerImages: [],
        }),
      },
    }),
  )
  return { testBackend, enrollSsh }
}

/** Stub the backends API the connection step verifies and saves through. */
function stubApi(over: Partial<ReturnType<typeof backends.backendsApi>> = {}): {
  test: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  sshEnroll: ReturnType<typeof vi.fn>
} {
  const test = vi.fn().mockResolvedValue({ ok: true, steps: [{ name: 'Connect & run', ok: true }] })
  const create = vi.fn().mockResolvedValue({ id: 'b1' })
  const sshEnroll = vi.fn()
  vi.spyOn(backends, 'backendsApi').mockReturnValue({
    list: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test,
    create,
    sshEnroll,
    ...over,
  } as unknown as ReturnType<typeof backends.backendsApi>)
  return { test, create, sshEnroll }
}

/** Walk to the execution step and choose SSH. The very next step must be the
 *  connection form — no engagement in between. */
async function stepToConnection(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
  fireEvent.click(screen.getByText('Claude'))
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  fireEvent.click(screen.getByText('SSH'))
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
}

/** Fill the minimum an SSH connection needs. */
function fillSsh(): void {
  fireEvent.change(screen.getByPlaceholderText('10.0.0.5 or user@host:22'), { target: { value: 'box.internal' } })
  fireEvent.change(screen.getByPlaceholderText('root'), { target: { value: 'kali' } })
}

describe('OnboardingModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    stubBridge()
    useApp.setState({
      onboardingOpen: true,
      defaultExecution: 'local',
      open: [],
      activeRoot: null,
      client: null,
      newEngagementOpen: false,
    })
  })

  it('lands on the connection form directly after SSH, with no engagement open', async () => {
    render(<OnboardingModal />)
    await stepToConnection()

    expect(screen.getByText('Connection details')).toBeTruthy()
    expect(screen.getByText('Step 4 of 5')).toBeTruthy()
    // The whole point: no engagement, no engine, and the fields are still there.
    expect(useApp.getState().client).toBeNull()
    expect(screen.queryByText('Open engagement')).toBeNull()
    for (const label of ['Name', 'Host', 'User', 'Port']) expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByPlaceholderText('~/.ssh/id_ed25519')).toBeTruthy()
  })

  it('prefills port, user and key from the machine so there is little to type', async () => {
    render(<OnboardingModal />)
    await stepToConnection()

    await waitFor(() => expect((screen.getByPlaceholderText('22') as HTMLInputElement).value).toBe('22'))
    expect((screen.getByPlaceholderText('root') as HTMLInputElement).value).toBe('bx0')
    expect((screen.getByPlaceholderText('~/.ssh/id_ed25519') as HTMLInputElement).value).toBe(
      '/home/u/.ssh/id_ed25519',
    )
    // Only the host is genuinely unknown, so that is all that stays empty.
    expect((screen.getByPlaceholderText('10.0.0.5 or user@host:22') as HTMLInputElement).value).toBe('')
  })

  it('fills the whole connection from a ~/.ssh/config entry in one click', async () => {
    render(<OnboardingModal />)
    await stepToConnection()
    await waitFor(() => expect(screen.getByRole('button', { name: 'kali-box' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'kali-box' }))

    expect((screen.getByPlaceholderText('10.0.0.5 or user@host:22') as HTMLInputElement).value).toBe('10.0.0.5')
    expect((screen.getByPlaceholderText('root') as HTMLInputElement).value).toBe('root')
    expect((screen.getByPlaceholderText('22') as HTMLInputElement).value).toBe('2222')
    // Enough to verify without touching the keyboard.
    expect((screen.getByRole('button', { name: /verify/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('splits a pasted user@host:port across the three fields', async () => {
    render(<OnboardingModal />)
    await stepToConnection()

    fireEvent.change(screen.getByPlaceholderText('10.0.0.5 or user@host:22'), {
      target: { value: 'kali@10.1.1.9:2200' },
    })

    expect((screen.getByPlaceholderText('10.0.0.5 or user@host:22') as HTMLInputElement).value).toBe('10.1.1.9')
    expect((screen.getByPlaceholderText('root') as HTMLInputElement).value).toBe('kali')
    expect((screen.getByPlaceholderText('22') as HTMLInputElement).value).toBe('2200')
  })

  it('offers Verify rather than Next, and only shows Next once it passes', async () => {
    const { testBackend } = stubBridge()
    const { create } = stubApi()
    render(<OnboardingModal />)
    await stepToConnection()

    // Verify is the only way forward, and it needs a describable connection.
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect((screen.getByRole('button', { name: /verify/i }) as HTMLButtonElement).disabled).toBe(true)

    fillSsh()
    expect((screen.getByRole('button', { name: /verify/i }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))

    await waitFor(() => expect(screen.getByText('Connection ok')).toBeTruthy())
    expect(testBackend).toHaveBeenCalledTimes(1)
    expect(testBackend.mock.calls[0]?.[0]).toMatchObject({
      profile: { kind: 'ssh', host: 'box.internal', user: 'kali' },
    })
    // Verifying must not save anything on its own.
    expect(create).not.toHaveBeenCalled()

    // A pass is what turns the primary button into Next.
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    // Step 5 is where a workspace takes the verified profile.
    expect(screen.getByText('Step 5 of 5')).toBeTruthy()
    fireEvent.click(screen.getByText('Open engagement'))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: 'ssh', kind: 'ssh', host: 'box.internal', user: 'kali' })
    // Saving is the end of it: no leftover dialog over the freshly opened engagement.
    await waitFor(() => expect(useApp.getState().onboardingOpen).toBe(false))
  })

  it('stays up with a retry when the save into the engagement fails', async () => {
    stubBridge()
    const { create } = stubApi()
    create.mockRejectedValue(new Error('database is locked'))
    render(<OnboardingModal />)
    await stepToConnection()
    fillSsh()
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByText('Open engagement'))

    await waitFor(() => expect(screen.getByText('database is locked')).toBeTruthy())
    expect(useApp.getState().onboardingOpen).toBe(true)
    expect(screen.getByRole('button', { name: /retry save/i })).toBeTruthy()
    // The header must not still be asking for an engagement that is already open.
    expect(screen.queryByText(/Open or create one to store/)).toBeNull()
  })

  it('keeps Verify when the test fails', async () => {
    stubBridge({
      testBackend: vi
        .fn()
        .mockResolvedValue({ ok: false, steps: [{ name: 'Connect & run', ok: false }], error: 'no route' }),
    })
    const { create } = stubApi()
    render(<OnboardingModal />)
    await stepToConnection()
    fillSsh()
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))

    await waitFor(() => expect(screen.getByText('Connection failed')).toBeTruthy())
    expect(screen.getByText('no route')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.getByRole('button', { name: /verify/i })).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('revokes a pass when the connection is edited afterwards', async () => {
    stubBridge()
    render(<OnboardingModal />)
    await stepToConnection()
    fillSsh()
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('10.0.0.5 or user@host:22'), {
      target: { value: 'other.internal' },
    })

    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.getByRole('button', { name: /verify/i })).toBeTruthy()
  })

  it('saves the generated key when password auth is enrolled', async () => {
    stubBridge({
      enrollSsh: vi.fn().mockResolvedValue({
        ok: true,
        identityFile: '/home/u/.ssh/exe_box',
        steps: [{ name: 'Generate key', ok: true }],
      }),
    })
    const { create } = stubApi()
    render(<OnboardingModal />)
    await stepToConnection()
    fillSsh()
    fireEvent.click(screen.getByRole('tab', { name: /password/i }))
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))

    await waitFor(() => expect(screen.getByText('/home/u/.ssh/exe_box')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByText('Open engagement'))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    // The profile points at the generated key, and the password never leaves the form.
    expect(create.mock.calls[0]?.[0]).toMatchObject({ identityFile: '/home/u/.ssh/exe_box' })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('password')
  })

  it('creates through the shared New-engagement modal, not a bare folder picker', async () => {
    stubBridge()
    const { create } = stubApi()
    render(<OnboardingModal />)
    await stepToConnection()
    fillSsh()
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    fireEvent.click(screen.getByText('New engagement'))

    // The same modal the sidebar + opens — no folder dialog of our own.
    expect(useApp.getState().newEngagementOpen).toBe(true)
    expect(window.executioner.pickFolder).not.toHaveBeenCalled()
    // And the wizard steps aside rather than stacking on top of it.
    expect(screen.queryByText('Step 5 of 5')).toBeNull()

    // Once that modal has made the engagement and closed, the wizard resumes on
    // the same step and stores the profile it was holding.
    useApp.setState({ newEngagementOpen: false, client: { post: vi.fn() } as never })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ kind: 'ssh', host: 'box.internal' })
    await waitFor(() => expect(useApp.getState().onboardingOpen).toBe(false))
  })

  it('leaves the local path on its four-step engagement flow', async () => {
    render(<OnboardingModal />)
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
    fireEvent.click(screen.getByText('Claude'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText('Step 4 of 4')).toBeTruthy()
    expect(screen.getByText('Engagement')).toBeTruthy()
  })
})
