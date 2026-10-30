import type { JSX } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import { cn } from '../../lib/utils.js'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

/**
 * Drops HTML comments from the tree. Raw HTML is never rendered, so without
 * this an `<!-- marker -->` (like the briefing markers the engine writes)
 * shows up as literal text in the page.
 */
export function remarkStripComments() {
  const isComment = (node: MdNode): boolean =>
    node.type === 'html' && /^\s*<!--[\s\S]*?-->\s*$/.test(node.value ?? '')
  const strip = (node: MdNode): void => {
    if (!node.children) return
    node.children = node.children.filter((child) => !isComment(child))
    node.children.forEach(strip)
  }
  return (tree: MdNode): void => strip(tree)
}

/**
 * The rendered-markdown pane (GitHub-flavoured, raw HTML disabled for safety).
 *
 * `className` replaces the page-like layout the file viewer wants, so a caller
 * rendering markdown into a narrow panel — a finding's description — can drop
 * the centred column and the wide gutters without restyling the prose itself.
 */
export function MarkdownRender({ source, className }: { source: string; className?: string }): JSX.Element {
  return (
    <div className={cn('markdown-body', className ?? 'mx-auto max-w-3xl px-8 py-6')}>
      <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkStripComments]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
        {source}
      </Markdown>
    </div>
  )
}
