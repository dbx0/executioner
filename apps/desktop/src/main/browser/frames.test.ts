import { describe, expect, it } from 'vitest'
import { FrameTracker } from './frames'

const info = (targetId: string, url = 'http://f/') => ({ targetId, type: 'iframe', url })

describe('FrameTracker', () => {
  it('records iframe targets only', () => {
    const t = new FrameTracker()
    expect(t.attach('s1', info('T1'))).toMatchObject({ sessionId: 's1', targetId: 'T1', url: 'http://f/' })
    expect(t.attach('s2', { targetId: 'W', type: 'worker', url: '' })).toBeUndefined()
    expect(t.has('s1')).toBe(true)
    expect(t.has('s2')).toBe(false)
  })

  it('detaching a session drops the iframes nested under it', () => {
    const t = new FrameTracker()
    t.attach('s1', info('T1'))
    t.attach('s2', info('T2'), 's1')
    t.attach('s3', info('T3'))
    expect(t.detach('s1').sort()).toEqual(['s1', 's2'])
    expect(t.has('s2')).toBe(false)
    expect(t.has('s3')).toBe(true)
    expect(t.detach('nope')).toEqual([])
  })

  it('finds a child by frame id within its parent session', () => {
    const t = new FrameTracker()
    t.attach('s1', info('T1'))
    t.attach('s2', info('T2'), 's1')
    expect(t.childFor(undefined, 'T1')?.sessionId).toBe('s1')
    expect(t.childFor('s1', 'T2')?.sessionId).toBe('s2')
    expect(t.childFor(undefined, 'T2')).toBeUndefined()
  })

  it('tags urls with the frame url and falls back for the page', () => {
    const t = new FrameTracker()
    t.attach('s1', info('T1'))
    t.setUrl('s1', 'http://f/2')
    expect(t.urlOf('s1', 'http://page/')).toBe('http://f/2')
    expect(t.urlOf(undefined, 'http://page/')).toBe('http://page/')
  })
})
