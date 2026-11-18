import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/button.js'
import { Dialog, DialogFooter, DialogTitle } from './ui/dialog.js'
import {
  isReturningUser,
  latestRelease,
  markSeen,
  onOpenWhatsNew,
  readSeenVersion,
  unseenReleases,
  type Release,
  type ReleaseMedia,
} from '../lib/whats-new.js'
import { RELEASES } from '../whats-new/releases.js'

function Media({ media }: { media: ReleaseMedia }): JSX.Element {
  // A clip that moves on its own is skipped for people who asked for less motion;
  // they get the first frame and the player controls instead.
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="aspect-video w-full shrink-0 overflow-hidden border-b border-glass-border bg-black">
      {media.kind === 'video' ? (
        <video
          src={media.src}
          aria-label={media.alt}
          className="size-full object-cover"
          autoPlay={!still}
          controls={still}
          loop
          muted
          playsInline
        />
      ) : (
        <img src={media.src} alt={media.alt} className="size-full object-cover" />
      )}
    </div>
  )
}

function ReleaseNotes({ release, heading }: { release: Release; heading: boolean }): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <p className="text-[12px] tabular-nums text-muted-foreground">Version {release.version}</p>
        {heading ? (
          <h2 className="mt-0.5 text-[18px] font-semibold leading-snug">{release.title}</h2>
        ) : (
          <h3 className="mt-0.5 text-[14px] font-medium">{release.title}</h3>
        )}
        {release.summary !== '' && <p className="mt-1 text-[13px] text-muted-foreground">{release.summary}</p>}
      </div>
      {release.sections.map((section) => (
        <div key={section.title}>
          <h4 className="text-[12px] font-medium text-muted-foreground">{section.title}</h4>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[13px] marker:text-tertiary-foreground">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/**
 * The "What's new" dialog. It opens by itself the first time the app runs after
 * an update, with the clip of the headline change on top and the notes of every
 * release since the last one seen below. The version button opens it
 * again with the latest release.
 *
 * Escape is also handled here on the window, not only by the dialog shell: the
 * key can arrive while focus is outside the dialog (a tour card, the page).
 */
export function WhatsNew({
  releases = RELEASES,
  current = __APP_VERSION__,
}: {
  releases?: Release[]
  current?: string
}): JSX.Element | null {
  const [shown, setShown] = useState<Release[]>(() =>
    unseenReleases({ releases, current, seen: readSeenVersion(), returning: isReturningUser() }),
  )

  // Whatever was decided above, this version now counts as seen, so the dialog
  // opens once per update and a fresh install starts tracking from here.
  useEffect(() => markSeen(current), [current])

  useEffect(
    () =>
      onOpenWhatsNew(() => {
        const latest = latestRelease(releases, current)
        if (latest !== null) setShown([latest])
      }),
    [releases, current],
  )

  const open = shown.length > 0
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShown([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const [first, ...older] = shown
  if (first === undefined) return null
  const close = (): void => setShown([])

  return (
    // Raised: it can open over another dialog, and it always wins.
    <Dialog onClose={close} label="What's new" raised className="relative w-[640px]">
      <DialogTitle className="sr-only">What&apos;s new</DialogTitle>
      {/* Sits on the clip, which is black in every theme, so it stays light on dark. */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-full bg-black/50 text-white/80 outline-none transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X aria-hidden className="size-4" />
      </button>
      {first.media !== undefined && <Media media={first.media} />}
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <ReleaseNotes release={first} heading />
        {older.map((release) => (
          <div key={release.version} className="border-t border-glass-border pt-5">
            <ReleaseNotes release={release} heading={false} />
          </div>
        ))}
      </div>
      <DialogFooter className="justify-between px-6">
        <a
          href={`https://github.com/dbx0/executioner/releases/tag/v${first.version}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Full release notes
        </a>
        <Button size="sm" onClick={close} autoFocus>
          Got it
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
