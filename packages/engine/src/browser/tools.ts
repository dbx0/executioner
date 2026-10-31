import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { canonicaliseAsset, evaluateScope, isCanonicalAsset, type BrowserAction } from '@exe/protocol'
import type { Project } from '@exe/project'
import type { ToolCaller } from '../mcp/toolset.js'
import type { BrowserHostHub } from './host-hub.js'
import type { BrowserRegistry } from './registry.js'

/** A tool result that also carries an image, which rpc.ts turns into MCP image content. */
export interface McpImageResult {
  __mcpImage: { data: string; mimeType: 'image/png' }
  result: unknown
}

export const BROWSER_TOOL_NAMES = [
  'browser_open',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_select',
  'browser_eval',
  'browser_wait',
  'browser_screenshot',
  'browser_log',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

const MAX_WAIT_MS = 30_000
const DEFAULT_WAIT_MS = 5_000

const dialog = { dialog: z.enum(['accept', 'dismiss']).optional(), promptText: z.string().optional() }

const ARGS = {
  browser_open: z.object({ url: z.string().min(1).optional() }),
  browser_navigate: z.object({ url: z.string().min(1), ...dialog }),
  browser_snapshot: z.object({}),
  browser_click: z.object({ ref: z.string().min(1), ...dialog }),
  browser_type: z.object({
    ref: z.string().min(1),
    text: z.string(),
    clear: z.boolean().optional(),
    submit: z.boolean().optional(),
    ...dialog,
  }),
  browser_press: z.object({ key: z.string().min(1), ...dialog }),
  browser_select: z.object({ ref: z.string().min(1), values: z.array(z.string()) }),
  browser_eval: z.object({ expression: z.string().min(1), ...dialog }),
  browser_wait: z.object({
    selector: z.string().min(1).optional(),
    navigation: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(MAX_WAIT_MS).default(DEFAULT_WAIT_MS),
  }),
  browser_screenshot: z.object({ fullPage: z.boolean().optional() }),
  browser_log: z.object({ since: z.number().int().nonnegative().optional() }),
} as const satisfies Record<BrowserToolName, z.ZodType>

const ACTION: Record<BrowserToolName, BrowserAction> = {
  browser_open: 'ensure',
  browser_navigate: 'navigate',
  browser_snapshot: 'snapshot',
  browser_click: 'click',
  browser_type: 'type',
  browser_press: 'press',
  browser_select: 'select',
  browser_eval: 'eval',
  browser_wait: 'wait',
  browser_screenshot: 'screenshot',
  browser_log: 'log',
}

export interface BrowserToolsDeps {
  registry: BrowserRegistry
  hub: BrowserHostHub
  project: Project
}

function isBrowserTool(name: string): name is BrowserToolName {
  return (BROWSER_TOOL_NAMES as readonly string[]).includes(name)
}

/** The agent-facing browser tools. Each call drives the browser its own session owns, never one named by the agent. */
export class BrowserTools {
  constructor(private readonly deps: BrowserToolsDeps) {}

  /** Judged against the scope rules for the agent's information; never enforced. */
  private scopeStatus(url: string): string | undefined {
    const asset = canonicaliseAsset({ kind: 'url', value: url })
    if (!isCanonicalAsset(asset)) return undefined
    return evaluateScope(asset, this.deps.project.scopeRules.all()).status
  }

  async call(name: BrowserToolName, args: unknown, caller: ToolCaller): Promise<unknown> {
    if (!isBrowserTool(name)) throw new Error(`unknown tool: ${String(name)}`)
    const { registry, hub, project } = this.deps
    const sessionId = caller.sessionId
    if (sessionId === undefined || sessionId === '') throw new Error('Browser tools need an agent session.')
    const parsed = ARGS[name].parse(args ?? {}) as Record<string, unknown>
    const item = registry.ownedBy(sessionId) ?? registry.create({ owner: sessionId })

    registry.activity(item.id, true)
    let raw: unknown
    try {
      raw = await hub.call(item.id, ACTION[name], parsed)
    } finally {
      registry.activity(item.id, false)
    }

    const result = (raw ?? {}) as Record<string, unknown>
    const url = typeof result.url === 'string' ? result.url : undefined
    const title = typeof result.title === 'string' ? result.title : undefined
    if (url !== undefined || title !== undefined) {
      registry.update(item.id, { ...(url === undefined ? {} : { url }), ...(title === undefined ? {} : { title }) })
    }

    switch (name) {
      case 'browser_open':
        return { browserId: item.id, url: url ?? '', title: title ?? '', ...this.withScope(url) }
      case 'browser_navigate':
        return { url: url ?? '', title: title ?? '', ...this.withScope(url) }
      case 'browser_snapshot':
        return { url: url ?? '', title: title ?? '', snapshot: result.snapshot }
      case 'browser_click':
      case 'browser_type':
      case 'browser_press':
      case 'browser_select':
        return { url: url ?? '', title: title ?? '' }
      case 'browser_eval':
        return { value: result.value }
      case 'browser_wait':
        return { url: url ?? '', title: title ?? '', matched: result.matched === true }
      case 'browser_log':
        return { entries: result.entries ?? [], next: result.next ?? 0 }
      case 'browser_screenshot': {
        const data = typeof result.data === 'string' ? result.data : ''
        if (data === '') throw new Error('The browser returned no screenshot.')
        const path = join(project.evidenceDir('browser'), `${Date.now()}-${item.id}.png`)
        writeFileSync(path, Buffer.from(data, 'base64'))
        const out: McpImageResult = { __mcpImage: { data, mimeType: 'image/png' }, result: { path } }
        return out
      }
    }
  }

  private withScope(url: string | undefined): { scopeStatus?: string } {
    const status = url === undefined ? undefined : this.scopeStatus(url)
    return status === undefined ? {} : { scopeStatus: status }
  }
}
