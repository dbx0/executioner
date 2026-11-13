import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TargetFact } from '../../../api/targets.js'
import { FACT_KIND_LABELS, FACT_KIND_ORDER, FACT_RENDERERS } from '../fact-sections.js'
import { CertificateFacts, certificateExpiry } from './CertificateFacts.js'
import { DnsRecordFacts } from './DnsRecordFacts.js'

const fact = (id: string, kind: string, data: Record<string, unknown>): TargetFact =>
  ({ id, targetId: 't1', kind, executionId: null, nodeId: 'n1', collectedAt: '2026-11-01T00:00:00.000Z', data }) as TargetFact

const NOW = new Date('2026-11-12T00:00:00.000Z').getTime()

describe('certificateExpiry', () => {
  it('counts the days a valid certificate has left', () => {
    expect(certificateExpiry('2027-03-12T00:00:00.000Z', NOW)).toEqual({ text: '120d left', tone: 'ok' })
  })

  it('calls out a certificate inside its last 30 days', () => {
    expect(certificateExpiry('2026-11-30T00:00:00.000Z', NOW)).toEqual({ text: '18d left', tone: 'soon' })
  })

  it('says how long ago an expired certificate ran out', () => {
    expect(certificateExpiry('2026-11-02T00:00:00.000Z', NOW)).toEqual({ text: 'expired 10d ago', tone: 'expired' })
  })

  it('says nothing when the date is missing or unreadable', () => {
    expect(certificateExpiry(undefined, NOW)).toBeNull()
    expect(certificateExpiry('soon', NOW)).toBeNull()
  })
})

describe('the target detail registry', () => {
  it('gives the new fact kinds a section of their own, not the raw output dump', () => {
    for (const kind of ['certificate', 'dns_record']) {
      expect(FACT_KIND_ORDER).toContain(kind)
      expect(FACT_KIND_LABELS[kind]).toBeDefined()
      expect(FACT_RENDERERS[kind]).toBeDefined()
    }
  })
})

describe('CertificateFacts', () => {
  it('lists the names a certificate covers next to its issuer', () => {
    render(
      <CertificateFacts
        facts={[fact('c1', 'certificate', { port: 443, issuer: 'R11', sans: 'example.com,www.example.com', not_after: '2099-01-01T00:00:00Z' })]}
      />,
    )
    expect(screen.getByText('example.com, www.example.com')).toBeTruthy()
    expect(screen.getByText('R11')).toBeTruthy()
  })
})

describe('DnsRecordFacts', () => {
  it('shows where a name points before its mail and text records', () => {
    render(
      <DnsRecordFacts
        facts={[
          fact('d1', 'dns_record', { name: 'example.com', type: 'TXT', value: 'v=spf1 include:a.com,b.com -all' }),
          fact('d2', 'dns_record', { name: 'example.com', type: 'A', value: '1.1.1.1,1.0.0.1' }),
        ]}
      />,
    )
    const cells = screen.getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(cells[0]).toContain('1.1.1.1, 1.0.0.1')
    // A TXT value is free text: its own commas are left exactly as published.
    expect(cells[1]).toContain('v=spf1 include:a.com,b.com -all')
  })
})
