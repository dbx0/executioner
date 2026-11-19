import type { NewEngagementTab } from '../../../store/types.js'

export type TabId = NewEngagementTab
export type Phase = 'form' | 'running' | 'done'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'ai', label: 'Start with AI' },
  { id: 'manual', label: 'Manual' },
  { id: 'open', label: 'Open existing' },
]

export function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}
