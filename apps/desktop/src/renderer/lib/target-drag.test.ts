import { describe, expect, it } from 'vitest'
import { readTargetDrag, setTargetDrag, TARGET_DND_MIME } from './target-drag.js'

/** A minimal DataTransfer stand-in backed by a string map. */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (type: string, val: string) => store.set(type, val),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer
}

describe('target-drag', () => {
  it('round-trips an item through our MIME and mirrors the text to text/plain', () => {
    const dt = fakeDataTransfer()
    setTargetDrag(dt, { kind: 'target', text: 'example.com', target: 'example.com' })
    expect(dt.getData('text/plain')).toBe('example.com')
    expect(readTargetDrag(dt)).toBe('example.com')
  })

  it('returns null for a drop that is not one of our drags', () => {
    const dt = fakeDataTransfer()
    dt.setData('text/plain', 'some pasted text')
    expect(readTargetDrag(dt)).toBeNull()
  })

  it('returns null for a malformed payload', () => {
    const dt = fakeDataTransfer()
    dt.setData(TARGET_DND_MIME, '{not json')
    expect(readTargetDrag(dt)).toBeNull()
  })
})
