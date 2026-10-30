import { fireEvent, render } from '@testing-library/react'
import type { JSX } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../store.js'
import { useKeybindings } from './Shell.js'

function Harness(): JSX.Element {
  useKeybindings()
  return <div />
}

const state = () => useApp.getState()

const splitPane = vi.fn()
const moveFocus = vi.fn()
const closePane = vi.fn()

function seed(view: 'terminals' | 'scope' = 'terminals', pinned = false): void {
  splitPane.mockReset()
  moveFocus.mockReset()
  closePane.mockReset()
  useApp.setState({
    activeView: view,
    layouts: [
      { id: 'terminal:t1', root: { type: 'leaf', id: 'p1', item: { kind: 'terminal', id: 't1' } }, focusedLeafId: 'p1' },
      { id: 'terminal:t2', root: { type: 'leaf', id: 'p2', item: { kind: 'terminal', id: 't2' } }, focusedLeafId: 'p2' },
    ],
    activeLayoutId: 'terminal:t2',
    tabMeta: pinned ? { 'terminal:t2': { pinned: true } } : {},
    splitPane,
    moveFocus,
    closePane,
  })
}

const press = (key: string, init: KeyboardEventInit): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  fireEvent(window, e)
  return e
}

describe('workspace keybindings', () => {
  beforeEach(() => seed())

  it('the split shortcuts split the focused pane of the active layout', () => {
    render(<Harness />)
    const e = press('D', { ctrlKey: true, shiftKey: true })
    expect(splitPane).toHaveBeenCalledWith('p2', 'row')
    expect(e.defaultPrevented).toBe(true)
    press('E', { ctrlKey: true, shiftKey: true })
    expect(splitPane).toHaveBeenLastCalledWith('p2', 'col')
  })

  it('the focus shortcut moves focus', () => {
    render(<Harness />)
    press('ArrowRight', { ctrlKey: true, altKey: true })
    expect(moveFocus).toHaveBeenCalledWith('right')
  })

  it('Ctrl+W closes the focused pane, not the layout', () => {
    render(<Harness />)
    press('w', { ctrlKey: true })
    expect(closePane).toHaveBeenCalledWith('p2')
  })

  it('a pinned layout is protected from Ctrl+W', () => {
    seed('terminals', true)
    render(<Harness />)
    const e = press('w', { ctrlKey: true })
    expect(closePane).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })

  it('the split and focus shortcuts only act while the Terminals view is showing', () => {
    seed('scope')
    render(<Harness />)
    const e = press('D', { ctrlKey: true, shiftKey: true })
    press('ArrowRight', { ctrlKey: true, altKey: true })
    expect(splitPane).not.toHaveBeenCalled()
    expect(moveFocus).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
    expect(state().activeView).toBe('scope')
  })
})
