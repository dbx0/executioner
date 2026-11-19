import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Release } from '../lib/whats-new.js'
import { openWhatsNew, readSeenVersion } from '../lib/whats-new.js'
import { WhatsNew } from './WhatsNew.js'

const releases: Release[] = [
  {
    version: '0.0.9',
    title: 'Actions',
    summary: 'Run a workflow or a tool on its own.',
    media: { kind: 'video', src: 'actions.webm', alt: 'The Actions page' },
    sections: [{ title: 'New', items: ['An Actions page', 'One session per target'] }],
  },
  { version: '0.0.8', title: 'Installer fixes', summary: '', sections: [{ title: 'Fixed', items: ['The macOS installer'] }] },
]

beforeEach(() => localStorage.clear())

describe('WhatsNew', () => {
  it('opens once after an update, with the clip on top and the changes below', () => {
    localStorage.setItem('exe.whatsNewSeen', '0.0.8')
    const { unmount } = render(<WhatsNew releases={releases} current="0.0.9" />)

    const dialog = screen.getByRole('dialog', { name: "What's new" })
    expect(dialog.querySelector('video')?.getAttribute('src')).toBe('actions.webm')
    expect(screen.getByText('Actions')).toBeTruthy()
    expect(screen.getByText('An Actions page')).toBeTruthy()
    expect(screen.queryByText('The macOS installer')).toBeNull()
    expect(readSeenVersion()).toBe('0.0.9')

    unmount()
    render(<WhatsNew releases={releases} current="0.0.9" />)
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()
  })

  it('stays closed on a fresh install and remembers the version', () => {
    render(<WhatsNew releases={releases} current="0.0.9" />)
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()
    expect(readSeenVersion()).toBe('0.0.9')
  })

  it('closes on Got it and on Escape', () => {
    localStorage.setItem('exe.whatsNewSeen', '0.0.8')
    render(<WhatsNew releases={releases} current="0.0.9" />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()

    act(() => openWhatsNew())
    expect(screen.getByRole('dialog', { name: "What's new" })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()
  })

  it('can be opened again on request, showing the latest release', () => {
    localStorage.setItem('exe.whatsNewSeen', '0.0.9')
    render(<WhatsNew releases={releases} current="0.0.9" />)
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()
    act(() => openWhatsNew())
    expect(screen.getByText('An Actions page')).toBeTruthy()
  })
})
