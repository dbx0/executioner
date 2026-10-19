import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TargetDetailView } from './TargetDetail.js'
import type { ScreenshotItem, TargetDetail } from '../../api/targets.js'

function makeTarget(): TargetDetail {
  return {
    id: 't1',
    kind: 'domain',
    value: 'example.com',
    apex: 'example.com',
    parentId: null,
    source: 'manual',
    scopeStatus: 'in',
    scopeReason: 'in scope by example.com',
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-02T00:00:00.000Z',
    findings: [
      {
        id: 'fd1',
        title: 'Open admin panel',
        severity: 'high',
        status: 'open',
        description: '',
        details: '',
        targetId: 't1',
        source: 'agent',
        executionId: null,
        nodeId: null,
        evidencePath: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    facts: [
      {
        id: 'f1',
        targetId: 't1',
        kind: 'port',
        executionId: 'exec-1234abcd',
        nodeId: 'node-a',
        collectedAt: '2026-01-01T00:00:00.000Z',
        data: { port: 443, protocol: 'tcp', service: 'https', state: 'open' },
      },
      {
        id: 'f2',
        targetId: 't1',
        kind: 'technology',
        executionId: null,
        nodeId: 'node-a',
        collectedAt: '2026-01-01T00:00:00.000Z',
        data: { name: 'nginx', version: '1.25.0', source: 'wappalyzer' },
      },
      {
        id: 'f3',
        targetId: 't1',
        kind: 'whois',
        executionId: null,
        nodeId: null,
        collectedAt: '2026-01-01T00:00:00.000Z',
        data: { registrar: 'MarkMonitor Inc.', country: 'US' },
      },
    ],
  }
}

const oneScreenshot: ScreenshotItem[] = [
  {
    factId: 'sf1',
    nodeId: 'node-a',
    executionId: 'exec-1',
    collectedAt: '2026-01-01T00:00:00.000Z',
    url: 'https://example.com',
    dataUrl: 'data:image/png;base64,AAAA',
  },
]

describe('TargetDetailView', () => {
  it('renders the target value, a port, a technology name, and a whois field', () => {
    render(<TargetDetailView target={makeTarget()} screenshots={[]} />)
    expect(screen.getAllByText('example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('443')).toBeTruthy()
    expect(screen.getByText('nginx')).toBeTruthy()
    expect(screen.getByText('MarkMonitor Inc.')).toBeTruthy()
  })

  it('renders a screenshot image with the provided dataUrl', () => {
    render(<TargetDetailView target={makeTarget()} screenshots={oneScreenshot} />)
    const img = document.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('runs the delete confirm flow', () => {
    const onDelete = vi.fn()
    render(<TargetDetailView target={makeTarget()} screenshots={[]} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Delete target and all subdomains?')).toBeTruthy()
    fireEvent.click(screen.getByText('Confirm'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('closes from the header when a handler is supplied', () => {
    const onClose = vi.fn()
    render(<TargetDetailView target={makeTarget()} screenshots={[]} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close details'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves out the close button when nothing can close it', () => {
    render(<TargetDetailView target={makeTarget()} screenshots={[]} />)
    expect(screen.queryByLabelText('Close details')).toBeNull()
  })

  it('calls onRename with the new value', () => {
    const onRename = vi.fn()
    render(<TargetDetailView target={makeTarget()} screenshots={[]} onRename={onRename} />)
    const input = screen.getByLabelText('Target value') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'renamed.com' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onRename).toHaveBeenCalledWith({ value: 'renamed.com' })
  })
})

describe('TargetDetailView — scope verdict', () => {
  it('says why an asset is outside the engagement', () => {
    const target = makeTarget()
    render(
      <TargetDetailView
        target={{
          ...target,
          scopeStatus: 'unknown',
          scopeReason: 'no scope rule matches example.com',
        }}
        screenshots={[]}
      />,
    )
    expect(screen.getByText(/no scope rule matches example\.com/i)).toBeTruthy()
  })

  it('stays quiet for an asset that is plainly in scope', () => {
    render(<TargetDetailView target={makeTarget()} screenshots={[]} />)
    expect(screen.queryByText(/in scope by example\.com/i)).toBeNull()
  })
})
