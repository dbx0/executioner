import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { MISSING, str, Table, Td, Tr } from './primitives.js'

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
          <Tr key={f.id}>
            <Td mono>{str(d['port'])}</Td>
            <Td>{str(d['protocol'] ?? d['transport'])}</Td>
            <Td>{service}</Td>
            <Td>{str(d['state'] ?? 'open')}</Td>
            <Td mono muted>
              {f.nodeId ?? MISSING}
            </Td>
          </Tr>
        )
      })}
    </Table>
  )
}
