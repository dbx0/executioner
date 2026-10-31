import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AttentionToast } from './AttentionToast'

describe('AttentionToast', () => {
  it('names who is waiting, and Show runs the action then closes the notch', () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    render(
      <AttentionToast who="claude-1" text="is waiting on you in the browser" description="Solve the captcha" actionLabel="Show" onAction={onAction} onDismiss={onDismiss} />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('claude-1 is waiting on you in the browser')
    expect(alert.getAttribute('title')).toBe('Solve the captcha')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('Later closes it without acting', () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    render(<AttentionToast who="a" text="t" actionLabel="Show" onAction={onAction} onDismiss={onDismiss} />)
    expect(screen.getByRole('alert').getAttribute('title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onAction).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
