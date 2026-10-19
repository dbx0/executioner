import type { JSX } from 'react'
import { Container, Laptop, Server } from 'lucide-react'
import { Select, type SelectOption } from '../../components/ui/select.js'
import type { BackendProfile } from '../../api/backends.js'

/** The pseudo-id of the connection that runs on the engine host. */
export const LOCAL = 'local'

function kindIcon(kind: BackendProfile['kind']): JSX.Element {
  const Icon = kind === 'docker' ? Container : kind === 'ssh' ? Server : Laptop
  return <Icon className="size-4" strokeWidth={1.75} />
}

/**
 * Where tools run: this machine or a saved connection. It sits in the page
 * header because it is page-wide state — the catalog's install marks and every
 * run started from the form both follow it.
 */
export function ConnectionPicker({
  profiles,
  value,
  onChange,
}: {
  profiles: BackendProfile[]
  value: string
  onChange: (id: string) => void
}): JSX.Element {
  const options: SelectOption[] = [
    { value: LOCAL, label: 'This machine', icon: kindIcon('local') },
    ...profiles.map((p) => ({ value: p.id, label: p.name, icon: kindIcon(p.kind) })),
  ]
  return (
    <div className="w-48 shrink-0">
      <Select ariaLabel="Connection" value={value} onValueChange={onChange} options={options} className="h-8" />
    </div>
  )
}
