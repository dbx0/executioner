import type { JSX } from 'react'
/** Shared layout primitives for the Settings sub-pages. */

/** A sub-page's title + optional one-line description, sitting above its body. */
export function PageHeading({
  title,
  description,
}: {
  title: string
  description?: string
}): JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description !== undefined && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
    </div>
  )
}

/** A small uppercase group label between rows within a sub-page. */
export function GroupLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/** A labelled setting row: label/description on the left, control on the right. */
export function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string | undefined
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {description !== undefined && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
