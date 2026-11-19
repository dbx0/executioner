import { useState } from 'react'
import type { JSX } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumericField } from './NumericField.js'

function Harness({ onChange, emptyAs }: { onChange: (n: number | undefined) => void; emptyAs?: number }): JSX.Element {
  const [value, setValue] = useState<number | undefined>(40)
  return (
    <NumericField
      aria-label="threads"
      value={value}
      {...(emptyAs === undefined ? {} : { emptyAs })}
      onChange={(n) => {
        setValue(n)
        onChange(n)
      }}
    />
  )
}

const field = (): HTMLInputElement => screen.getByLabelText('threads') as HTMLInputElement

describe('NumericField', () => {
  it('reports numbers and keeps a half-typed decimal on screen', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(field().value).toBe('40')

    fireEvent.change(field(), { target: { value: '1.' } })
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(field().value).toBe('1.')
  })

  it('clears to no value by default, or to the given fallback', () => {
    const onChange = vi.fn()
    const { unmount } = render(<Harness onChange={onChange} />)
    fireEvent.change(field(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    unmount()

    render(<Harness onChange={onChange} emptyAs={0} />)
    fireEvent.change(field(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
    expect(field().value).toBe('')
  })

  it('steps with the stepper buttons instead of native spin buttons', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(field().type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenLastCalledWith(41)
  })
})
