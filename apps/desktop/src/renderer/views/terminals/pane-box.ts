import type { CSSProperties } from 'react'
import type { Rect } from '../../lib/pane-tree.js'

const EPS = 1e-6

/** Half the panel gutter: what each pane gives up on an edge it shares with another pane. */
const HALF_GAP = 'var(--panel-gap) / 2'

function span(start: number, size: number, before: boolean, after: boolean): { start: string; size: string } {
  const cuts = (before ? 1 : 0) + (after ? 1 : 0)
  return {
    start: before ? `calc(${start * 100}% + ${HALF_GAP})` : `${start * 100}%`,
    size: cuts === 0 ? `${size * 100}%` : cuts === 1 ? `calc(${size * 100}% - ${HALF_GAP})` : `calc(${size * 100}% - var(--panel-gap))`,
  }
}

/**
 * Where a pane card sits inside the pane host. A pane's rect is a fraction of
 * the host; the card is inset by half the panel gutter on every edge it shares
 * with another pane, so two neighbours are one full gutter apart while the
 * outer edges still reach the host's edge.
 */
export function paneBox(rect: Rect): CSSProperties {
  const h = span(rect.x, rect.w, rect.x > EPS, rect.x + rect.w < 1 - EPS)
  const v = span(rect.y, rect.h, rect.y > EPS, rect.y + rect.h < 1 - EPS)
  return { left: h.start, top: v.start, width: h.size, height: v.size }
}

/**
 * The classes of a pane card: the black ink surface, absolutely placed by
 * `paneBox`. The focused pane of a split takes a stronger hairline, not a color.
 */
export function paneCardClass(focused: boolean): string {
  return focused ? 'absolute border-border-strong' : 'absolute'
}
