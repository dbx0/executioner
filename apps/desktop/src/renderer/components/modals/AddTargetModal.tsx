import type { JSX } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Plus } from 'lucide-react'
import { targetsApi } from '../../api/targets.js'
import { detectTargetKind } from '../../lib/detect-target.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Spinner } from '../ui/spinner.js'
import { apiErrorMessage } from '../../lib/api-error.js'

/**
 * Add a target: type the value and the kind is auto-detected (domain/subdomain/
 * ip/cidr/url) and shown read-only inside the input. Creates the target and
 * refreshes.
 */
export function AddTargetModal({
  client,
  onClose,
  onCreated,
}: {
  client: AxiosInstance
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const kind = useMemo(() => detectTargetKind(value), [value])

  const add = async (): Promise<void> => {
    if (value.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await targetsApi(client).create({ kind, value: value.trim(), source: 'manual' })
      onCreated()
      onClose()
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not add that target.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-[440px] max-w-[92vw] flex-col gap-4 rounded-panel border border-glass-border bg-popover p-5 shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
          Add target
        </h2>

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-muted-foreground">Value</span>
            <div className="relative">
              <Input
                ref={inputRef}
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                placeholder="example.com · api.example.com · 10.0.0.1 · 10.0.0.0/24 · https://example.com"
                className="pr-[92px] font-mono text-[13px]"
              />
              {/* The detected kind, read only: it rides inside the pill so the
                  operator sees what the value will be filed as before adding it. */}
              {value.trim() !== '' && (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-control bg-glass-active px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {kind}
                </span>
              )}
            </div>
          </label>

          {error !== null && (
            <p role="alert" className="px-1 text-[12px] text-status-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || value.trim() === ''} onClick={() => void add()}>
            {busy ? <Spinner size="sm" /> : <Plus strokeWidth={2} />}
            Add target
          </Button>
        </div>
      </div>
    </div>
  )
}
