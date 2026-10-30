import { describe, expect, it } from 'vitest'
import { workspaceShortcut } from './shortcuts.js'

const key = (k: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: k, ...mods })

describe('workspaceShortcut', () => {
  it('maps the macOS keys', () => {
    expect(workspaceShortcut(key('d', { metaKey: true }), true)).toEqual({ kind: 'split', dir: 'row' })
    expect(workspaceShortcut(key('D', { metaKey: true, shiftKey: true }), true)).toEqual({ kind: 'split', dir: 'col' })
    expect(workspaceShortcut(key('ArrowLeft', { metaKey: true, altKey: true }), true)).toEqual({ kind: 'focus', dir: 'left' })
    expect(workspaceShortcut(key('ArrowDown', { metaKey: true, altKey: true }), true)).toEqual({ kind: 'focus', dir: 'down' })
  })

  it('maps the Linux and Windows keys', () => {
    expect(workspaceShortcut(key('D', { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: 'split', dir: 'row' })
    expect(workspaceShortcut(key('E', { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: 'split', dir: 'col' })
    expect(workspaceShortcut(key('ArrowRight', { ctrlKey: true, altKey: true }), false)).toEqual({ kind: 'focus', dir: 'right' })
    expect(workspaceShortcut(key('ArrowUp', { ctrlKey: true, altKey: true }), false)).toEqual({ kind: 'focus', dir: 'up' })
  })

  it('leaves the keys a shell owns alone', () => {
    for (const mac of [true, false]) {
      expect(workspaceShortcut(key('d', { ctrlKey: true }), mac)).toBeNull()
      expect(workspaceShortcut(key('w', { ctrlKey: true }), mac)).toBeNull()
      expect(workspaceShortcut(key('ArrowLeft', { ctrlKey: true }), mac)).toBeNull()
      expect(workspaceShortcut(key('d'), mac)).toBeNull()
    }
  })

  it('does not take the other platform keys', () => {
    expect(workspaceShortcut(key('D', { ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(workspaceShortcut(key('d', { metaKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('e', { metaKey: true, shiftKey: true }), true)).toBeNull()
  })

  it('takes Cmd+Arrow only with Alt on macOS', () => {
    expect(workspaceShortcut(key('ArrowLeft', { metaKey: true }), true)).toBeNull()
    expect(workspaceShortcut(key('ArrowUp', { metaKey: true, altKey: true }), true)).toEqual({ kind: 'focus', dir: 'up' })
  })

  it('takes Ctrl+Shift+Arrow on neither Linux nor Windows', () => {
    expect(workspaceShortcut(key('ArrowLeft', { ctrlKey: true, shiftKey: true }), false)).toBeNull()
  })

  it('ignores Ctrl+Meta combinations on every platform', () => {
    expect(workspaceShortcut(key('D', { ctrlKey: true, metaKey: true, shiftKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('ArrowLeft', { ctrlKey: true, metaKey: true, altKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('d', { ctrlKey: true, metaKey: true }), true)).toBeNull()
    expect(workspaceShortcut(key('ArrowLeft', { ctrlKey: true, metaKey: true, altKey: true }), true)).toBeNull()
  })

  it('does not treat Shift with Alt and Arrow as a focus move', () => {
    expect(workspaceShortcut(key('ArrowLeft', { ctrlKey: true, altKey: true, shiftKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('ArrowLeft', { metaKey: true, altKey: true, shiftKey: true }), true)).toBeNull()
  })

  it('leaves AltGr-style Ctrl+Alt printable keys alone', () => {
    expect(workspaceShortcut(key('d', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('e', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(workspaceShortcut(key('d', { metaKey: true, altKey: true }), true)).toBeNull()
  })

  it('leaves close alone: Cmd+W is not a split and Ctrl+Shift+W is not taken', () => {
    expect(workspaceShortcut(key('w', { metaKey: true }), true)).toBeNull()
    expect(workspaceShortcut(key('W', { metaKey: true, shiftKey: true }), true)).toBeNull()
    expect(workspaceShortcut(key('W', { ctrlKey: true, shiftKey: true }), false)).toBeNull()
  })
})
