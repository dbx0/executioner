import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useApp } from '../store.js'
import { Landing } from './Landing.js'

beforeEach(() => {
  useApp.setState({ newEngagementOpen: false, newEngagementTab: 'ai', error: null, busy: false, recents: [] })
})

afterEach(() => {
  cleanup()
  useApp.setState({ newEngagementOpen: false, newEngagementTab: 'ai' })
})

describe('Landing', () => {
  it('opens the engagement modal on the Open existing tab, not the bare folder picker', () => {
    render(<Landing />)
    fireEvent.click(screen.getByRole('button', { name: /open engagement/i }))
    expect(useApp.getState().newEngagementOpen).toBe(true)
    expect(useApp.getState().newEngagementTab).toBe('open')
  })

  it('opens the same modal on the AI tab for a new engagement', () => {
    render(<Landing />)
    fireEvent.click(screen.getByRole('button', { name: /new engagement/i }))
    expect(useApp.getState().newEngagementOpen).toBe(true)
    expect(useApp.getState().newEngagementTab).toBe('ai')
  })
})
