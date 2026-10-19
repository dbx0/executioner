/**
 * The Google Gemini mark — its signature four-point "spark" star, drawn as a
 * single path filled with Gemini's blue→purple brand gradient so it reads as
 * the real mark rather than a monochrome glyph. This is nominative use: the
 * mark identifies a Gemini agent session. Self-contained inline SVG (no
 * external asset, no network). `className` controls sizing (e.g. `size-4`).
 */
import type { JSX } from 'react'
import { BrandGlyph } from './BrandGlyph.js'

export function GeminiLogo({ className }: { className?: string }): JSX.Element {
  return (
    <BrandGlyph className={className}>
      <defs>
        <linearGradient id="geminiLogoGradient" x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#7B5CF0" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        fill="url(#geminiLogoGradient)"
        d="M12 2c.28 4.68 2.32 7.72 7 8-4.68.28-6.72 3.32-7 8-.28-4.68-2.32-7.72-7-8 4.68-.28 6.72-3.32 7-8Z"
      />
    </BrandGlyph>
  )
}
