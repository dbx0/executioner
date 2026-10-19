import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ParamDrawer } from './ParamDrawer.js'

const params = [
  { name: 'threads', type: 'number', default: 40, min: 1, max: 200 },
  { name: 'scan_type', type: 'string', default: '-sV', oneOf: ['-sV', '-sS'] },
  { name: 'wordlist', type: 'string', default: '/usr/share/wordlists/common.txt' },
]

describe('ParamDrawer', () => {
  it('renders an input per param with its current value', () => {
    render(<ParamDrawer params={params as never} values={{ threads: 40 }} onChange={() => {}} />)
    expect((screen.getByLabelText('threads') as HTMLInputElement).value).toBe('40')
  })

  it('renders a Select for a param with an allowlist', () => {
    render(<ParamDrawer params={params as never} values={{}} onChange={() => {}} />)
    const trigger = screen.getByLabelText('scan_type')
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.textContent).toContain('-sV')
  })

  it('calls onChange when a value is edited', () => {
    const onChange = vi.fn()
    render(<ParamDrawer params={params as never} values={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('wordlist'), { target: { value: '/tmp/w.txt' } })
    expect(onChange).toHaveBeenCalledWith('wordlist', '/tmp/w.txt')
  })

  it('shows a param example inside its field', () => {
    const specs = [{ name: 'extensions', type: 'string', placeholder: 'php,html,txt' }]
    render(<ParamDrawer params={specs as never} values={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('extensions').getAttribute('placeholder')).toBe('php,html,txt')
  })

  it('offers the target chip under a text field unless told to hide chips', () => {
    const { unmount } = render(<ParamDrawer params={params as never} values={{}} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '{{ target.value }}' })).toBeTruthy()
    unmount()
    render(<ParamDrawer params={params as never} values={{}} onChange={() => {}} chips={[]} />)
    expect(screen.queryByRole('button', { name: '{{ target.value }}' })).toBeNull()
  })
})

describe('toParamSpecs', () => {
  it('maps the engine param record into flat specs', async () => {
    const { toParamSpecs } = await import('./ParamDrawer.js')
    const specs = toParamSpecs({
      threads: { type: 'number', default: 40 },
      mode: { type: 'enum', values: ['fast', 'full'], default: 'fast' },
      verbose: { type: 'bool', default: false },
      note: { type: 'string' },
    })
    expect(specs).toEqual([
      { name: 'threads', type: 'number', default: 40 },
      { name: 'mode', type: 'string', oneOf: ['fast', 'full'], default: 'fast' },
      { name: 'verbose', type: 'boolean', default: false },
      { name: 'note', type: 'string' },
    ])
  })
})
