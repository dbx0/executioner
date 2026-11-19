import type { JSX } from 'react'
import { memo, useState } from 'react'
import { Sparkles, Check } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AssistantMessage, AssistantProposal } from '../../api/assistant.js'
import { Button } from '../ui/button.js'
import { cn } from '../../lib/utils.js'

/** Compact markdown for assistant replies, styled with the app's tokens. */
const CODE_INLINE = 'rounded-[5px] bg-glass-active px-1 py-0.5 font-mono text-[12px]'

/** Defined once: a fresh object per render would rebuild the renderer's component map on every keystroke. */
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 break-words last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5 break-words">{children}</li>,
  h1: ({ children }) => <h1 className="mb-1 mt-1 text-[14px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-1 text-[13.5px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 text-[13px] font-semibold">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-glass-border pl-2 text-muted-foreground">{children}</blockquote>
  ),
  code: ({ className, children }) =>
    className?.startsWith('language-') ? (
      <code className="font-mono text-[12px]">{children}</code>
    ) : (
      <code className={CODE_INLINE}>{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="scrollbar-sleek mb-2 overflow-x-auto rounded-[10px] border border-glass-border bg-background p-2 text-[12px] last:mb-0">
      {children}
    </pre>
  ),
}

const REMARK_PLUGINS = [remarkGfm]

function AssistantMarkdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="text-[13px] leading-relaxed">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/**
 * One message. Memoized because the draft textarea's state lives in the panel:
 * every keystroke re-renders it, and re-rendering a bubble re-parses that whole
 * reply through remark — enough to make typing lag once a thread has a few
 * answers in it. `message` objects and `onApply` are stable, so this holds.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  onApply,
}: {
  message: AssistantMessage
  onApply: (proposal: AssistantProposal) => void
}): JSX.Element {
  const isUser = message.role === 'user'
  const [applied, setApplied] = useState(false)
  return (
    <div className={cn('flex min-w-0 flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          // [overflow-wrap:anywhere] + break-words keep long tokens/URLs inside
          // the bubble so nothing spills out and forces a horizontal scrollbar.
          'max-w-[92%] min-w-0 break-words [overflow-wrap:anywhere] rounded-[14px] px-3 py-2 text-[13px] text-foreground',
          isUser ? 'whitespace-pre-wrap bg-glass-active' : 'bg-glass',
        )}
      >
        {message.content === '' ? (
          <span className="text-muted-foreground">(no reply)</span>
        ) : isUser ? (
          message.content
        ) : (
          <AssistantMarkdown text={message.content} />
        )}
      </div>
      {message.proposal !== null && (
        <div className="mt-2 w-[92%] rounded-[14px] border border-glass-border bg-glass p-2.5">
          <p className="mb-2 text-[12px] text-muted-foreground">{message.proposal.summary}</p>
          <Button
            variant="glass"
            size="sm"
            className="w-full"
            onClick={() => {
              onApply(message.proposal as AssistantProposal)
              setApplied(true)
            }}
          >
            {applied ? <Check className="size-4" strokeWidth={1.75} /> : <Sparkles className="size-4" strokeWidth={1.75} />}
            {applied ? 'Applied' : 'Apply to canvas'}
          </Button>
        </div>
      )}
    </div>
  )
})
