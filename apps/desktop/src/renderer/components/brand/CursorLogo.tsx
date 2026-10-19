/**
 * The Cursor mark — its faceted pyramid glyph, drawn as three planes with a
 * light-to-dark gradient echoing Cursor's monochrome brand cube. Nominative
 * use: the mark identifies a Cursor (`cursor-agent`) session. Self-contained
 * inline SVG (no external asset, no network). `className` controls sizing
 * (e.g. `size-4`).
 */
import type { JSX } from 'react'
import { BrandGlyph } from './BrandGlyph.js'

export function CursorLogo({ className }: { className?: string }): JSX.Element {
  return (
    <BrandGlyph className={className}>
      <path fill="#9B9B9B" d="M12 2 3 7v10l9 5V12L3 7Z" />
      <path fill="#5C5C5C" d="M12 2v10l9-5-9-5Z" />
      <path fill="#3A3A3A" d="M12 12v10l9-5V7l-9 5Z" />
    </BrandGlyph>
  )
}
