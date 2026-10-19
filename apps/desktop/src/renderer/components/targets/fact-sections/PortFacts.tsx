import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { str, Table } from './primitives.js'

export function PortFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <Table head={['Port', 'Protocol', 'Service', 'State', 'Node']}>
      {facts.map((f) => {
        const d = f.data
        const version = d['version']
        const service =
          version !== undefined && version !== null && version !== ''
            ? `${str(d['service'])} ${String(version)}`
            : str(d['service'])
        return (
          <tr key={f.id} className="border-b border-border/60">
            <td className="px-2 py-1.5 font-mono">{str(d['port'])}</td>
            <td className="px-2 py-1.5">{str(d['protocol'] ?? d['transport'])}</td>
            <td className="px-2 py-1.5">{service}</td>
            <td className="px-2 py-1.5">{str(d['state'] ?? 'open')}</td>
            <td className="px-2 py-1.5 font-mono text-muted-foreground">{f.nodeId ?? '—'}</td>
          </tr>
        )
      })}
    </Table>
  )
}
