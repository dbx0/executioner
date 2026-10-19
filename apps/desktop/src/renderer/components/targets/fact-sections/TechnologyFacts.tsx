import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { str, Table } from './primitives.js'

function techDetails(d: Record<string, unknown>): string {
  const version = d['version']
  if (version !== undefined && version !== null && version !== '') return String(version)
  const details = d['details']
  if (Array.isArray(details)) return details.length === 0 ? '—' : details.map((x) => String(x)).join(', ')
  return str(details)
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
    if (techDetails(existing.data) === '—' && techDetails(f.data) !== '—') {
      byName.set(name, f)
    }
  }
  const rows = [...byName.values()]
  return (
    <Table head={['Name', 'Details', 'Source']}>
      {rows.map((f) => (
        <tr key={f.id} className="border-b border-border/60">
          <td className="px-2 py-1.5 font-mono">{str(f.data['name'])}</td>
          <td className="px-2 py-1.5">{techDetails(f.data)}</td>
          <td className="px-2 py-1.5 text-muted-foreground">{str(f.data['source'])}</td>
        </tr>
      ))}
    </Table>
  )
}
