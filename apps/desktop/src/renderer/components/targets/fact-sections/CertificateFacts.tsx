import { useState, type JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { cn } from '../../../lib/utils.js'
import { MISSING, str, Table, Td, Tr } from './primitives.js'

const DAY_MS = 86_400_000
/** Inside this many days a certificate is called out as expiring. */
const EXPIRING_SOON_DAYS = 30

type ExpiryTone = 'ok' | 'soon' | 'expired'

const EXPIRY_TONE: Record<ExpiryTone, string> = {
  expired: 'font-medium text-status-error',
  soon: 'font-medium text-attention',
  ok: 'text-muted-foreground',
}

/**
 * How long a certificate has left, in words. Computed at render time from
 * `not_after`: a stored "days left" would be wrong the day after it was saved.
 */
export function certificateExpiry(notAfter: unknown, now: number): { text: string; tone: ExpiryTone } | null {
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
          <Tr key={f.id}>
            <Td mono>{str(d['port'])}</Td>
            <Td>{str(d['issuer'])}</Td>
            <Td mono>{str(names)}</Td>
            <Td>
              {date(d['not_after'])}
              {expiry !== null && <span className={cn('ml-2', EXPIRY_TONE[expiry.tone])}>{expiry.text}</span>}
            </Td>
            <Td mono muted>
              {f.nodeId ?? MISSING}
            </Td>
          </Tr>
        )
      })}
    </Table>
  )
}
