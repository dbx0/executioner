import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Checkbox } from './checkbox.js'

describe('Checkbox', () => {
  it('exposes its state as a checkbox role and toggles on click', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(<Checkbox aria-label="Verbose" checked={false} onCheckedChange={onCheckedChange} />)
    const box = screen.getByRole('checkbox', { name: 'Verbose' })
    expect(box.getAttribute('aria-checked')).toBe('false')
    expect(box.querySelector('svg')).toBeNull()

    fireEvent.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    rerender(<Checkbox aria-label="Verbose" checked onCheckedChange={onCheckedChange} />)
    expect(box.getAttribute('aria-checked')).toBe('true')
    expect(box.querySelector('svg')).not.toBeNull()
    fireEvent.click(box)
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it('is a button, so Space toggles it and Enter does not', () => {
    render(<Checkbox aria-label="Verbose" checked={false} onCheckedChange={() => undefined} />)
    const box = screen.getByRole('checkbox', { name: 'Verbose' })
    expect(box.tagName).toBe('BUTTON')
    expect(box.getAttribute('type')).toBe('button')
    // Enter is cancelled so the button's default activation never fires.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false)
    expect(fireEvent.keyDown(box, { key: ' ' })).toBe(true)
  })

  it('is named and toggled by a wrapping label', () => {
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Checkbox checked={false} onCheckedChange={onCheckedChange} />
        Include targets
      </label>,
    )
    expect(screen.getByRole('checkbox', { name: 'Include targets' })).toBeTruthy()
    fireEvent.click(screen.getByText('Include targets'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does nothing while disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Verbose" id="v" checked={false} disabled onCheckedChange={onCheckedChange} />)
    const box = screen.getByRole('checkbox', { name: 'Verbose' }) as HTMLButtonElement
    expect(box.id).toBe('v')
    expect(box.disabled).toBe(true)
    fireEvent.click(box)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
