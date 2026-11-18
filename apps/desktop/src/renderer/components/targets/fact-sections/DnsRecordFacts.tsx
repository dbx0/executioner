import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { MISSING, str, Table, Td, Tr } from './primitives.js'

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
          <Tr key={f.id}>
            <Td mono>{str(d['name'])}</Td>
            <Td>{str(d['type'])}</Td>
            <Td mono className="break-all">
              {value}
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
