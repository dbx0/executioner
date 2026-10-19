import type { JSX } from 'react'
/**
 * The OpenCode mark — the project's official 64x64 brand icon, embedded as a
 * self-contained data URI (no external asset, no network). Nominative use: the
 * mark identifies an OpenCode agent session. `className` controls sizing; it
 * defaults to size-4 so it never renders at natural size where a caller passes
 * no className (e.g. the spawn menu).
 */
const OPENCODE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAG1BMVEUTEBD///9aWFgAAABHREQGAABeXFxLSUkvLCzJjnlJAAAAVUlEQVRYhe3WMQrAMAhAUduaJvc/cWYLxUgIJfb/UfBNDooQ5exycvcPJ08AyAU8DygOjM0B1gLFFAfqbaphQE+TAgAAfAU0NbUw8BbAL4DpR5No0zpjhghz2AXH2AAAAABJRU5ErkJggg=='

export function OpenCodeLogo({ className }: { className?: string }): JSX.Element {
  return (
    <img
      src={OPENCODE_ICON}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className ?? 'size-4 shrink-0'}
      style={{ borderRadius: '4px', objectFit: 'contain' }}
    />
  )
}
