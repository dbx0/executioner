import { describe, expect, it } from 'vitest'
import { ptyUrl } from './pty.js'

describe('ptyUrl', () => {
  it('builds the pty websocket url with id and token', () => {
    expect(ptyUrl({ port: 5000, token: 'abc', projectRoot: '/x' }, 'sess-1')).toBe(
      'ws://127.0.0.1:5000/pty/sess-1?token=abc',
    )
  })
})
