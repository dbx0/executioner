import type { JSX } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import { SearchField } from './SearchField.js'

/** The text cut at every case-insensitive occurrence of `query`, with the matches flagged. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const parts: { text: string; match: boolean }[] = []
  let at = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), match: false })
    parts.push({ text: m[0], match: true })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false })
  return parts
}

/**
 * A live run's stream. It follows the newest line until you scroll up to read,
 * and finds text in what has arrived so far. Keyed by run, so each run starts
 * following with an empty search.
 */
export function LiveStream({ lines }: { lines: string[] }): JSX.Element {
  const bottom = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [needle, setNeedle] = useState('')
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines.length, follow])

  const text = lines.join('')
  const query = needle.trim()
  const parts = query === '' ? null : splitMatches(text, query)
  const count = parts === null ? 0 : parts.filter((p) => p.match).length

  // Scrolling away from the bottom means reading: stop following until the
  // reader comes back down or asks for it.
  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const box = e.currentTarget
    setFollow(box.scrollHeight - box.scrollTop - box.clientHeight < 24)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-glass-border px-3 py-1.5">
        <SearchField
          size="sm"
          wrapperClassName="flex-1"
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          placeholder="Find in output"
          aria-label="Find in output"
        />
        {query !== '' && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
            {count === 1 ? '1 match' : `${count} matches`}
          </span>
        )}
        <Tip label={follow ? 'Stop following new output' : 'Follow new output'}>
          <Button
            variant={follow ? 'glass' : 'ghost'}
            size="xs"
            aria-pressed={follow}
            onClick={() => {
              if (follow) {
                setFollow(false)
                return
              }
              setFollow(true)
              bottom.current?.scrollIntoView({ block: 'end' })
            }}
            className={cn('shrink-0 text-[11px]', !follow && 'text-muted-foreground')}
          >
            Autoscroll
          </Button>
        </Tip>
      </div>
      <div onScroll={onScroll} className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-3.5">
        {lines.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Waiting for output…</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
            {parts === null
              ? text
              : parts.map((p, i) =>
                  p.match ? (
                    <mark key={i} className="rounded-sm bg-status-running/30 text-foreground">
                      {p.text}
                    </mark>
                  ) : (
                    <Fragment key={i}>{p.text}</Fragment>
                  ),
                )}
            <div ref={bottom} />
          </pre>
        )}
      </div>
    </div>
  )
}
