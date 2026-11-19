import { beforeEach, describe, expect, it } from 'vitest'
import { isReturningUser, latestRelease, markSeen, readSeenVersion, unseenReleases, type Release } from './whats-new.js'

const release = (version: string): Release => ({ version, title: `Release ${version}`, summary: '', sections: [] })
const releases = [release('0.0.9'), release('0.1.0'), release('0.0.10')]

describe('unseenReleases', () => {
  it('shows nothing on a fresh install', () => {
    expect(unseenReleases({ releases, current: '0.1.0', seen: null, returning: false })).toEqual([])
  })

  it('shows nothing when this version was already seen', () => {
    expect(unseenReleases({ releases, current: '0.1.0', seen: '0.1.0', returning: true })).toEqual([])
  })

  it('shows every release since the one last seen, newest first', () => {
    const shown = unseenReleases({ releases, current: '0.1.0', seen: '0.0.9', returning: true })
    expect(shown.map((r) => r.version)).toEqual(['0.1.0', '0.0.10'])
  })

  it('leaves out releases newer than the running version', () => {
    const shown = unseenReleases({ releases, current: '0.0.10', seen: '0.0.8', returning: true })
    expect(shown.map((r) => r.version)).toEqual(['0.0.10', '0.0.9'])
  })

  it('shows only the latest release to someone who used the app before it kept track', () => {
    const shown = unseenReleases({ releases, current: '0.1.0', seen: null, returning: true })
    expect(shown.map((r) => r.version)).toEqual(['0.1.0'])
  })

  it('shows nothing after an update that has no notes', () => {
    expect(unseenReleases({ releases, current: '0.1.1', seen: '0.1.0', returning: true })).toEqual([])
  })

  it('shows nothing after a downgrade', () => {
    expect(unseenReleases({ releases, current: '0.0.9', seen: '0.1.0', returning: true })).toEqual([])
  })
})

describe('latestRelease', () => {
  it('is the newest release up to the running version', () => {
    expect(latestRelease(releases, '0.0.10')?.version).toBe('0.0.10')
  })

  it('falls back to the newest release when none is that old', () => {
    expect(latestRelease(releases, '0.0.1')?.version).toBe('0.1.0')
  })
})

describe('seen version storage', () => {
  beforeEach(() => localStorage.clear())

  it('remembers the version last seen', () => {
    expect(readSeenVersion()).toBeNull()
    markSeen('0.0.9')
    expect(readSeenVersion()).toBe('0.0.9')
  })

  it('tells a returning user from a fresh install by what the app stored before', () => {
    expect(isReturningUser()).toBe(false)
    localStorage.setItem('exe.recents', '[]')
    expect(isReturningUser()).toBe(true)
  })
})
