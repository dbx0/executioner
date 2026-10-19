import type { JSX } from 'react'
export function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}
