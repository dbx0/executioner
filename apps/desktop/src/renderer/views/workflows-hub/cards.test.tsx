import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentCard } from './cards.js'
import type { SavedAgent } from '../../api/saved-agents.js'

const agent: SavedAgent = {
  id: 'a1',
  name: 'Recon Scout',
  description: 'Maps the attack surface',
  agent: 'claude',
  prompt: 'You are a recon specialist.',
  scope: 'global',
  createdAt: '',
  updatedAt: '',
}

describe('AgentCard', () => {
  it('fires onRun from a visible Run action', () => {
    const onRun = vi.fn()
    render(<AgentCard agent={agent} onRun={onRun} onEdit={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledOnce()
  })

  it('still exposes edit and delete', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(<AgentCard agent={agent} onRun={() => {}} onEdit={onEdit} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
