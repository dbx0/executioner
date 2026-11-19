import type { JSX } from 'react'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Spinner } from '../../components/ui/spinner.js'
import { detectTargetKind } from '../../lib/detect-target.js'

/** One example per target kind, for the field's placeholder. */
const EXAMPLES: Record<string, string> = {
  domain: 'example.com',
  subdomain: 'api.example.com',
  ip: '10.0.0.1',
  cidr: '10.0.0.0/24',
  url: 'https://example.com',
}

/** "a or b", "a, b or c". */
function either(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`
}

/**
 * Add a target without leaving the form. The kind is detected from the value,
 * the same way the Targets page detects it, and a kind this tool cannot take
 * is refused here with the reason rather than added and then left unpickable.
 */
export function AddTargetInline({
  toolName,
  accepts,
  onAdd,
}: {
  toolName: string
  /** Kinds the tool takes; empty takes any. */
  accepts: string[]
  /** Create the target and pick it; rejects with the engine's reason. */
  onAdd: (kind: string, value: string) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kinds = accepts.length === 0 ? Object.keys(EXAMPLES) : accepts
  const trimmed = value.trim()
  const kind = detectTargetKind(trimmed)

  const add = (): void => {
    if (trimmed === '' || busy) return
    if (accepts.length > 0 && !accepts.includes(kind)) {
      setError(`${toolName} takes ${either(accepts)} targets, and this looks like a ${kind}.`)
      return
    }
    setBusy(true)
    setError(null)
    onAdd(kind, trimmed)
      .then(() => setValue(''))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not add that target.'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
          placeholder={kinds.map((k) => EXAMPLES[k] ?? k).join(' · ')}
          aria-label="New target"
          className="h-8 min-w-0 flex-1 font-mono text-[12.5px]"
        />
        <Button variant="glass" size="sm" disabled={trimmed === '' || busy} onClick={add}>
          {busy ? <Spinner size="sm" /> : <Plus className="size-3.5" />}
          Add
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-[11.5px] text-status-error">
          {error}
        </p>
      ) : (
        trimmed !== '' && <p className="text-[11px] text-muted-foreground">Adds a {kind} target and picks it.</p>
      )}
    </div>
  )
}
