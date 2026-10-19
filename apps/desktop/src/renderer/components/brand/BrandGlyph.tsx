import type { JSX } from 'react'
/**
 * The shared `<svg>` wrapper behind the inline brand marks. Every SVG logo in
 * this folder draws into the same 24x24 viewBox and carries the same
 * accessibility attributes (`aria-hidden`, `focusable="false"`), so only the
 * artwork itself — the paths, their fills, and any gradient `<defs>` — differs
 * between them. `fill` and `fillRule` are optional and are simply omitted when
 * a mark colors its paths individually rather than at the root.
 *
 * This is a wrapper only: it holds no brand artwork and no brand colors.
 */
export function BrandGlyph({
  className,
  fill,
  fillRule,
  children,
}: {
  className?: string | undefined
  fill?: string | undefined
  fillRule?: 'nonzero' | 'evenodd' | 'inherit' | undefined
  children: React.ReactNode
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
      fillRule={fillRule}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}
