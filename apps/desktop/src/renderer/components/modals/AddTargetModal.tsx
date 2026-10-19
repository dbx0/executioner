import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Plus } from 'lucide-react'
import { targetsApi } from '../../api/targets.js'
import { detectTargetKind } from '../../lib/detect-target.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
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

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const kind = useMemo(() => detectTargetKind(value), [value])

  const add = async (): Promise<void> => {
    if (value.trim() === '') return
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex w-[440px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[14px] font-medium">Add target</div>

        <div className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1 text-[13px]">
            <span>Value</span>
            <div className="relative">
              <Input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                placeholder="example.com · api.example.com · 10.0.0.1 · 10.0.0.0/24 · https://example.com"
                className="h-9 pr-[84px] font-mono text-[13px]"
              />
              {value.trim() !== '' && (
                <span
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  title="Auto-detected kind"
                >
                  {kind}
                </span>
              )}
            </div>
          </label>

          {error !== null && <p className="text-[12px] text-status-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || value.trim() === ''} onClick={() => void add()}>
            <Plus className="size-4" strokeWidth={2} />
            Add target
          </Button>
        </div>
      </div>
    </div>
  )
}
