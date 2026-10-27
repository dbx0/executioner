import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../../store.js'
import { TOURS, tourIdFor, type TourId } from '../../lib/tours.js'
import { Button } from '../ui/button.js'

/** Breathing room between the highlighted element and the cutout around it. */
const PAD = 6
/** Gap between the cutout and the card. */
const GAP = 12
/** Margin the card keeps from the window edges. */
const EDGE = 16
const CARD_WIDTH = 320
/** Wait for a freshly opened page to lay out before measuring its anchors. */
const START_DELAY_MS = 350

interface Box {
  top: number
  left: number
  width: number
  height: number
}

/** The on-screen box of a `data-tour` anchor, or null when it is not rendered. */
function measure(target: string | undefined): Box | null {
  if (target === undefined) return null
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (el === null) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * Place the card beside the cutout: below it when there is room, else above,
 * else to the right or left, else over the middle of the window. Always kept
 * inside the window.
 */
export function placeCard(
  box: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number } {
  const clampX = (x: number): number => Math.min(Math.max(x, EDGE), view.width - card.width - EDGE)
  const clampY = (y: number): number => Math.min(Math.max(y, EDGE), view.height - card.height - EDGE)
  const centered = { top: clampY((view.height - card.height) / 2), left: clampX((view.width - card.width) / 2) }
  if (box === null) return centered

  const below = box.top + box.height + GAP
  if (below + card.height <= view.height - EDGE) return { top: below, left: clampX(box.left) }
  const above = box.top - GAP - card.height
  if (above >= EDGE) return { top: above, left: clampX(box.left) }
  const right = box.left + box.width + GAP
  if (right + card.width <= view.width - EDGE) return { top: clampY(box.top), left: right }
  const left = box.left - GAP - card.width
  if (left >= EDGE) return { top: clampY(box.top), left }
  return centered
}

/**
 * The first-visit walkthrough of the page on screen. Everything but the
 * highlighted element is darkened, clicks outside the card are swallowed, and
 * the tour only moves on from its own buttons. Finishing or skipping records
 * the tour as seen, so each page shows it once.
 */
export function PageTour(): JSX.Element | null {
  const view = useApp((s) => s.activeView)
  const hubTab = useApp((s) => s.hubTab)
  const hasEngagement = useApp((s) => s.connection !== null)
  const onboardingOpen = useApp((s) => s.onboardingOpen)
  const seen = useApp((s) => s.toursSeen)
  const markTourSeen = useApp((s) => s.markTourSeen)

  const candidate = hasEngagement && !onboardingOpen ? tourIdFor(view, hubTab) : null
  const tourId: TourId | null = candidate !== null && !seen.includes(candidate) ? candidate : null

  const [ready, setReady] = useState<TourId | null>(null)
  const [step, setStep] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [cardHeight, setCardHeight] = useState(180)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // A new page restarts from its first step, after the page has had a moment to render.
  // `ready` only counts while it matches the page on screen, so a stale one
  // never shows a tour for a page that has since been left.
  useEffect(() => {
    if (tourId === null) return
    const timer = setTimeout(() => {
      setStep(0)
      setReady(tourId)
    }, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [tourId])

  const steps = ready !== null && ready === tourId ? TOURS[ready] : null
  const current = steps?.[step]

  // Follow the anchor while the page loads data, resizes or scrolls under the card.
  useEffect(() => {
    if (current === undefined) return
    const update = (): void => {
      const next = measure(current.target)
      setBox((prev) => (sameBox(prev, next) ? prev : next))
      setViewport((prev) =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      )
    }
    update()
    const timer = setInterval(update, 200)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [current])

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h !== undefined && h > 0 && h !== cardHeight) setCardHeight(h)
  }, [current, cardHeight])

  useEffect(() => {
    if (current !== undefined) nextRef.current?.focus()
  }, [current])

  // Keys stay in the card: Tab cycles its buttons, and nothing reaches the page
  // or the app shortcuts behind it until the tour is done.
  const open = current !== undefined
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      const card = cardRef.current
      if (card === null) return
      if (e.key === 'Tab') {
        const buttons = [...card.querySelectorAll('button')]
        if (buttons.length === 0) return
        e.preventDefault()
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        buttons[next]?.focus()
        return
      }
      if (!(e.target instanceof Node && card.contains(e.target))) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (steps === null || current === undefined || ready === null) return null

  const last = step === steps.length - 1
  const finish = (): void => markTourSeen(ready)
  const pos = placeCard(box, { width: CARD_WIDTH, height: cardHeight }, viewport)

  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={(e) => e.preventDefault()}>
      {box === null ? (
        <div className="absolute inset-0 bg-black/60" />
      ) : (
        <div
          data-testid="tour-spotlight"
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary/70 transition-all duration-200"
          style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute flex flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-foreground shadow-floating"
        style={{ width: CARD_WIDTH, top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="tour-title" className="text-[14px] font-medium">
            {current.title}
          </h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{current.body}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {step + 1} of {steps.length}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={finish}>
            Skip tour
          </Button>
          <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Got it' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
