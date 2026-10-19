import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/button.js'
import type { InstallHint, ToolInfo } from '../../../api/tools.js'

/** Map process.platform → the label + InstallHint key for the current OS. */
const OS_ORDER: { key: keyof InstallHint; platform: string; label: string }[] = [
  { key: 'darwin', platform: 'darwin', label: 'macOS' },
  { key: 'linux', platform: 'linux', label: 'Linux' },
  { key: 'windows', platform: 'win32', label: 'Windows' },
]

/** A copyable command block with a guarded Copy button. */
function CommandBlock({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      },
      () => undefined,
    )
  }, [command])
  return (
    <div className="group relative">
      <pre className="overflow-x-auto scrollbar-sleek rounded-md border border-border bg-surface-1 px-3 py-2 pr-9 font-mono text-[12px] text-foreground">
        {command}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-3 hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

/** One OS's install line: label + command (or a muted "no command" note). */
function OsCommand({ label, command }: { label: string; command: string | undefined }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {command !== undefined && command !== '' ? (
        <CommandBlock command={command} />
      ) : (
        <p className="text-[12px] text-muted-foreground">No package command — see the note or project page below.</p>
      )}
    </div>
  )
}

/**
 * The install modal for a missing tool. On the local tab the engine host's OS
 * comes first, marked "(this machine)". On a remote connection we cannot know
 * the host's OS, so every OS is listed plainly and `platform` is left empty.
 * "Recheck" re-probes and closes.
 */
export function InstallModal({
  tool,
  platform,
  where,
  onClose,
  onRecheck,
  rechecking,
}: {
  tool: ToolInfo
  /** The engine host's process.platform, or '' when the target OS is unknown. */
  platform: string
  /** The connection the tool is missing on, shown under the title. */
  where: string
  onClose: () => void
  onRecheck: () => void
  rechecking: boolean
}): JSX.Element {
  const current = OS_ORDER.find((o) => o.platform === platform)
  const others = OS_ORDER.filter((o) => o.platform !== platform)
  const hint = tool.install

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Download className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-[14px] font-medium">
              Install <span className="font-mono">{tool.program}</span>
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">on {where}</div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-sleek px-4 py-4">
          {current !== undefined && <OsCommand label={`${current.label} (this machine)`} command={hint[current.key]} />}
          {others.map((o) => (
            <OsCommand key={o.key} label={o.label} command={hint[o.key]} />
          ))}

          {hint.note !== undefined && hint.note !== '' && (
            <p className="rounded-md border border-border bg-surface-1 px-3 py-2 text-[12px] text-muted-foreground">
              {hint.note}
            </p>
          )}

          {hint.url !== undefined && hint.url !== '' && (
            <a
              href={hint.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="size-3.5" /> {hint.url}
            </a>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="default" size="sm" disabled={rechecking} onClick={onRecheck}>
            {rechecking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
            Recheck
          </Button>
        </div>
      </div>
    </div>
  )
}
