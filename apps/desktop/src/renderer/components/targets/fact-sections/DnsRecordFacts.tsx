import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { str, Table } from './primitives.js'

/** The order a reader looks for them in: where it points first, then mail, then the rest. */
const TYPE_ORDER = ['A', 'AAAA', 'CNAME', 'PTR', 'MX', 'NS', 'TXT']

const rank = (type: unknown): number => {
  const i = TYPE_ORDER.indexOf(String(type))
  return i === -1 ? TYPE_ORDER.length : i
}

export function DnsRecordFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  const sorted = [...facts].sort(
    (a, b) => String(a.data['name']).localeCompare(String(b.data['name'])) || rank(a.data['type']) - rank(b.data['type']),
  )
  return (
    <Table head={['Name', 'Type', 'Value', 'Node']}>
      {sorted.map((f) => {
        const d = f.data
        // TXT is free text and may hold commas of its own; every other answer set
        // is a comma separated list of names or addresses.
        const value = d['type'] === 'TXT' ? str(d['value']) : str(String(d['value'] ?? '').split(',').filter((v) => v !== ''))
        return (
          <tr key={f.id} className="border-b border-border/60 align-top">
            <td className="px-2 py-1.5 font-mono">{str(d['name'])}</td>
            <td className="px-2 py-1.5">{str(d['type'])}</td>
            <td className="break-all px-2 py-1.5 font-mono">{value}</td>
            <td className="px-2 py-1.5 font-mono text-muted-foreground">{f.nodeId ?? '—'}</td>
          </tr>
        )
      })}
    </Table>
  )
}
