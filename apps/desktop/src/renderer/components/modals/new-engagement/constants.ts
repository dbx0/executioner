import type { NewEngagementTab } from '../../../store/types.js'

export type TabId = NewEngagementTab
export type Phase = 'form' | 'running' | 'done'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'ai', label: 'Start with AI' },
  { id: 'manual', label: 'Manual' },
  { id: 'open', label: 'Open existing' },
]

export const TEXTAREA_CLASS =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}
