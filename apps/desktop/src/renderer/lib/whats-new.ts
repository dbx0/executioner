/**
 * What's new: the notes shown once, the first time the app opens after an
 * update. The notes themselves are written by hand in whats-new/releases.ts and
 * ship inside the app, so the dialog works with no network.
 */

export interface ReleaseMedia {
  /** A looping clip (webm or mp4) or a still or animated image (gif, png, jpg). */
  kind: 'video' | 'image'
  src: string
  /** What the clip shows, for screen readers. */
  alt: string
}

export interface Release {
  /** Plain x.y.z, the version in package.json this note belongs to. */
  version: string
  /** The headline change. */
  title: string
  summary: string
  media?: ReleaseMedia
  sections: { title: string; items: string[] }[]
}

function parse(version: string): number[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return match === null ? [0, 0, 0] : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const newestFirst = (releases: Release[]): Release[] => [...releases].sort((a, b) => compareVersions(b.version, a.version))

/**
 * The releases to show on startup, newest first. Empty on a fresh install, when
 * this version was already seen, and after an update that has no notes.
 * `returning` is whether the app was used on this machine before; someone whose
 * copy predates this dialog has no seen version yet and gets the latest release only.
 */
export function unseenReleases(input: {
  releases: Release[]
  current: string
  seen: string | null
  returning: boolean
}): Release[] {
  const { current, seen } = input
  const upToCurrent = newestFirst(input.releases).filter((r) => compareVersions(r.version, current) <= 0)
  if (seen === null) return input.returning ? upToCurrent.slice(0, 1) : []
  return upToCurrent.filter((r) => compareVersions(r.version, seen) > 0)
}

/** The release to show on request: the newest up to the running version, else the newest there is. */
export function latestRelease(releases: Release[], current: string): Release | null {
  const sorted = newestFirst(releases)
  return sorted.find((r) => compareVersions(r.version, current) <= 0) ?? sorted[0] ?? null
}

const SEEN_KEY = 'exe.whatsNewSeen'
/** Keys the app writes during normal use; any of them means this is not a first launch. */
const HISTORY_KEYS = ['exe.recents', 'exe.openEngagements', 'exe.onboarded']

export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export function markSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    // Storage is unavailable: the dialog shows again next launch, which is harmless.
  }
}

export function isReturningUser(): boolean {
  try {
    return HISTORY_KEYS.some((key) => localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

const OPEN_EVENT = 'exe:whats-new'

/** Open the dialog on request (the version in the status bar). */
export function openWhatsNew(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function onOpenWhatsNew(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}
