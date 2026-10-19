import type { JSX } from 'react'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { Argv } from '../../api/nodes.js'

/** What the preview shows: the argv, the reason there is none yet, or nothing. */
export type CommandPreviewState = { argv: Argv } | { error: string } | null

/** The engine's stand-in for a target not picked yet; shown as is, never quoted. */
const STAND_IN = '<target>'

/** Quote one argv element the way a POSIX shell would need it. */
function shellQuote(arg: string): string {
  if (arg === STAND_IN) return arg
  if (arg !== '' && /^[\w@%+=:,./-]+$/.test(arg)) return arg
  return `'${arg.replaceAll("'", `'\\''`)}'`
}

/** The argv as one line a user could paste into a shell. */
export function commandLine(argv: Argv): string {
  return [argv.program, ...argv.args].map(shellQuote).join(' ')
}

/**
 * The command a run would execute, built by the engine from the form as it
 * stands. Seeing it before Run catches a wrong flag or an empty value, and it
 * can be copied to run by hand.
 */
export function CommandPreview({ state, more }: { state: CommandPreviewState; more: number }): JSX.Element | null {
  const [copied, setCopied] = useState(false)
  if (state === null) return null

  if ('error' in state) {
    return (
      <div className="border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        Command not ready: {state.error}
      </div>
    )
  }

  const line = commandLine(state.argv)
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(line)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <div className="flex items-start gap-2 border-t border-border bg-surface-1 px-3 py-2">
      <code
        aria-label="Command"
        className="max-h-[4.5rem] min-w-0 flex-1 overflow-y-auto scrollbar-sleek whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed"
      >
        <span className="select-none text-muted-foreground">$ </span>
        {line}
      </code>
      {more > 0 && (
        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
          and {more} more {more === 1 ? 'target' : 'targets'}
        </span>
      )}
      <Button variant="ghost" size="icon-xs" aria-label="Copy command" onClick={copy}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  )
}
