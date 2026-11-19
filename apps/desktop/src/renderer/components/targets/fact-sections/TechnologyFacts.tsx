import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { MISSING, str, Table, Td, Tr } from './primitives.js'

function techDetails(d: Record<string, unknown>): string {
  const version = d['version']
  if (version !== undefined && version !== null && version !== '') return String(version)
  return str(d['details'])
}

export function TechnologyFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  const byName = new Map<string, TargetFact>()
  for (const f of facts) {
    const name = str(f.data['name'])
    const existing = byName.get(name)
    if (existing === undefined) {
      byName.set(name, f)
      continue
    }
    // Prefer the row that carries a version / details.
    if (techDetails(existing.data) === MISSING && techDetails(f.data) !== MISSING) {
      byName.set(name, f)
    }
  }
  const rows = [...byName.values()]
  return (
    <Table head={['Name', 'Details', 'Source']}>
      {rows.map((f) => (
        <Tr key={f.id}>
          <Td mono>{str(f.data['name'])}</Td>
          <Td>{techDetails(f.data)}</Td>
          <Td muted>{str(f.data['source'])}</Td>
        </Tr>
      ))}
    </Table>
  )
}
