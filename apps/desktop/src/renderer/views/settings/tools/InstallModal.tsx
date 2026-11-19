import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Check, Copy, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../../components/ui/dialog.js'
import { Spinner } from '../../../components/ui/spinner.js'
import { Tip } from '../../../components/ui/tip.js'
import type { InstallHint, ToolInfo } from '../../../api/tools.js'

/** Map process.platform to the label + InstallHint key for the current OS. */
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
      <pre className="scrollbar-sleek overflow-x-auto rounded-[10px] border border-glass-border bg-background px-3 py-2 pr-9 font-mono text-[12px] text-foreground">
        {command}
      </pre>
      <Tip label={copied ? 'Copied' : 'Copy command'}>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy command"
          className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
        </button>
      </Tip>
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
        <p className="text-[12px] text-muted-foreground">No package command. See the note or project page below.</p>
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
    <Dialog onClose={onClose} label={`Install ${tool.program}`}>
      <DialogHeader
        icon={<Download className="size-4 shrink-0 text-muted-foreground" />}
        title={
          <>
            Install <span className="font-mono">{tool.program}</span>
          </>
        }
        description={<span className="block truncate">on {where}</span>}
      />

      <DialogBody className="flex flex-col gap-4">
        {current !== undefined && <OsCommand label={`${current.label} (this machine)`} command={hint[current.key]} />}
        {others.map((o) => (
          <OsCommand key={o.key} label={o.label} command={hint[o.key]} />
        ))}

        {hint.note !== undefined && hint.note !== '' && (
          <p className="rounded-[10px] border border-glass-border bg-glass px-3 py-2 text-[12px] text-muted-foreground">
            {hint.note}
          </p>
        )}

        {hint.url !== undefined && hint.url !== '' && (
          <a
            href={hint.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start rounded text-[12.5px] text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-3.5" /> {hint.url}
          </a>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button variant="default" size="sm" disabled={rechecking} onClick={onRecheck}>
          {rechecking ? <Spinner size="sm" /> : <RefreshCw className="size-3.5" />}
          Recheck
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
