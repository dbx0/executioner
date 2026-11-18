import type { JSX, ReactNode } from 'react'

export function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-2 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary-foreground">
      {children}
    </div>
  )
}
