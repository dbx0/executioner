import { useState, type JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { cn } from '../../../lib/utils.js'
import { str, Table } from './primitives.js'

const DAY_MS = 86_400_000
/** Inside this many days a certificate is called out as expiring. */
const EXPIRING_SOON_DAYS = 30

/**
 * How long a certificate has left, in words. Computed at render time from
 * `not_after`: a stored "days left" would be wrong the day after it was saved.
 */
export function certificateExpiry(notAfter: unknown, now: number): { text: string; tone: 'ok' | 'soon' | 'expired' } | null {
  if (typeof notAfter !== 'string' || notAfter === '') return null
  const end = new Date(notAfter).getTime()
  if (Number.isNaN(end)) return null
  const days = Math.floor((end - now) / DAY_MS)
  if (days < 0) return { text: `expired ${String(-days)}d ago`, tone: 'expired' }
  return { text: `${String(days)}d left`, tone: days <= EXPIRING_SOON_DAYS ? 'soon' : 'ok' }
}

const date = (v: unknown): string => {
  if (typeof v !== 'string' || v === '') return str(v)
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

export function CertificateFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  // Read once when the section mounts: rendering stays pure, and a day count
  // does not need to tick while the panel is open.
  const [now] = useState(() => Date.now())
  return (
    <Table head={['Port', 'Issuer', 'Names', 'Valid until', 'Node']}>
      {facts.map((f) => {
        const d = f.data
        const expiry = certificateExpiry(d['not_after'], now)
        const names = String(d['sans'] ?? d['subject_cn'] ?? '')
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n !== '')
        return (
          <tr key={f.id} className="border-b border-border/60 align-top">
            <td className="px-2 py-1.5 font-mono">{str(d['port'])}</td>
            <td className="px-2 py-1.5">{str(d['issuer'])}</td>
            <td className="px-2 py-1.5 font-mono">{str(names)}</td>
            <td className="px-2 py-1.5">
              {date(d['not_after'])}
              {expiry !== null && (
                <span
                  className={cn(
                    'ml-2',
                    expiry.tone === 'expired' && 'font-medium text-destructive',
                    expiry.tone === 'soon' && 'font-medium text-status-running',
                    expiry.tone === 'ok' && 'text-muted-foreground',
                  )}
                >
                  {expiry.text}
                </span>
              )}
            </td>
            <td className="px-2 py-1.5 font-mono text-muted-foreground">{f.nodeId ?? '—'}</td>
          </tr>
        )
      })}
    </Table>
  )
}
