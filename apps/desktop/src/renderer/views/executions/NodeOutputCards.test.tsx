import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodeOutputRow } from '../../api/executions.js'
import { NodeOutputCards } from './NodeOutputCards.js'
import { NodeOutputModal } from './NodeOutputModal.js'

const row = (over: Partial<NodeOutputRow>): NodeOutputRow => ({
  nodeId: 'nmap',
  status: 'succeeded',
  exitCode: 0,
  stdout: '',
  stderr: '',
  parsed: null,
  ...over,
})

describe('NodeOutputCards', () => {
  it('shows a card per node, including one that produced nothing at all', () => {
    render(
      <NodeOutputCards
        rows={[
          row({ nodeId: 'whois', stdout: 'Domain: example.com\nmore' }),
          // The signature of a tool that never spawned: failed, no exit code,
          // no output. It has to stay visible — that is the whole point.
          row({ nodeId: 'nmap', status: 'failed', exitCode: null }),
        ]}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('whois')).toBeTruthy()
    expect(screen.getByText('nmap')).toBeTruthy()
    expect(screen.getByText('Failed with no output')).toBeTruthy()
    expect(screen.getByText('no exit')).toBeTruthy()
  })

  it('previews the first line, and prefers stderr on a failed node', () => {
    render(
      <NodeOutputCards
        rows={[
          row({ nodeId: 'katana', status: 'failed', exitCode: 2, stdout: 'ignored', stderr: 'flag provided but not defined: -json' }),
        ]}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('flag provided but not defined: -json')).toBeTruthy()
    expect(screen.queryByText('ignored')).toBeNull()
    expect(screen.getByText('exit 2')).toBeTruthy()
  })

  it('shows no exit badge at all when an older engine omits the field', () => {
    // The field is absent, not null: unknown, so it must not be reported as a
    // failure on a node that plainly succeeded.
    const legacy = { nodeId: 'whois', status: 'succeeded', stdout: 'ok' } as unknown as NodeOutputRow
    render(<NodeOutputCards rows={[legacy]} onOpen={vi.fn()} />)
    expect(screen.queryByText(/exit/i)).toBeNull()
    expect(screen.queryByText('no exit')).toBeNull()
  })

  it('falls back to the parsed rows for a node that writes no stdout', () => {
    // screenshot and the other built-ins never write a stdout file; their result
    // is the parsed rows, so the card must not call that "no output".
    render(
      <NodeOutputCards
        rows={[row({ nodeId: 'screenshot', parsed: [{ path: '/ev/shot.png', width: 1280 }] })]}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('1 row')).toBeTruthy()
    expect(screen.queryByText('No output')).toBeNull()
    expect(screen.getByText(/shot\.png/)).toBeTruthy()
  })

  it('opens the clicked node', () => {
    const onOpen = vi.fn()
    const only = row({ nodeId: 'subfinder', stdout: 'a.example.com' })
    render(<NodeOutputCards rows={[only]} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('subfinder'))
    expect(onOpen).toHaveBeenCalledWith(only)
  })
})

describe('NodeOutputModal', () => {
  it('opens on stderr for a failed node, since that is where the reason is', () => {
    render(
      <NodeOutputModal
        row={row({ status: 'failed', exitCode: null, stderr: 'could not run "nmap" on the local backend: spawn nmap ENOENT' })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/spawn nmap ENOENT/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: /stderr/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('no exit code')).toBeTruthy()
  })

  it('opens on stdout for a node that succeeded, and switches on demand', () => {
    render(<NodeOutputModal row={row({ stdout: 'PORT 443 open', stderr: 'a warning' })} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /stdout/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('PORT 443 open')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /stderr/ }))
    expect(screen.getByText('a warning')).toBeTruthy()
  })

  it('opens on the parsed tab when there is no stdout to show', () => {
    render(
      <NodeOutputModal
        row={row({ nodeId: 'screenshot', parsed: [{ path: '/ev/shot.png' }] })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('tab', { name: /parsed/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/shot\.png/)).toBeTruthy()
  })

  it('says so when a stream is empty rather than showing a blank pane', () => {
    render(<NodeOutputModal row={row({ stdout: 'out' })} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /stderr/ }))
    expect(screen.getByText('Nothing was written to stderr.')).toBeTruthy()
  })
})
