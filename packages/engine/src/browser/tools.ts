import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
  'browser_network',
  'browser_response_body',
  'browser_rewrite_rules',
  'browser_upload',
  'browser_mouse',
  'browser_drag',
  'browser_emulate',
  'browser_ask_operator',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

const MAX_WAIT_MS = 30_000
// Agent CLIs give up on a tool call after about a minute, so a wait returns
// before that and the agent calls again to keep waiting.
const DEFAULT_ASK_TIMEOUT_SEC = 45
const MAX_ASK_TIMEOUT_SEC = 50
const DEFAULT_WAIT_MS = 5_000

const dialog = { dialog: z.enum(['accept', 'dismiss']).optional(), promptText: z.string().optional() }

const MAX_NETWORK_LIMIT = 500
const DEFAULT_NETWORK_LIMIT = 100
const DEFAULT_DRAG_STEPS = 10
const MAX_BODY_BYTES = 1_000_000

const brandVersion = z.object({ brand: z.string(), version: z.string() })
/** CDP Emulation.UserAgentMetadata: what client hints and navigator.userAgentData report. */
const userAgentMetadata = z.object({
  brands: z.array(brandVersion).optional(),
  fullVersionList: z.array(brandVersion).optional(),
  fullVersion: z.string().optional(),
  platform: z.string(),
  platformVersion: z.string(),
  architecture: z.string(),
  model: z.string(),
  mobile: z.boolean(),
  bitness: z.string().optional(),
  wow64: z.boolean().optional(),
})

/** One request or response rewrite. `null` in setHeaders removes that header. */
const ruleSchema = z.object({
  id: z.string().optional(),
  urlPattern: z.string().min(1),
  stage: z.enum(['request', 'response']).optional(),
  method: z.string().min(1).optional(),
  setHeaders: z.record(z.string(), z.string().nullable()).optional(),
  body: z.string().optional(),
  status: z.number().int().min(100).max(599).optional(),
})

export type Rule = z.infer<typeof ruleSchema>

const point = z.object({ x: z.number(), y: z.number() })
const target = z.union([z.string().min(1), point])
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional()

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
  browser_eval: z.object({ expression: z.string().min(1), frame: z.string().optional(), ...dialog }),
  browser_wait: z.object({
    selector: z.string().min(1).optional(),
    navigation: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(MAX_WAIT_MS).default(DEFAULT_WAIT_MS),
  }),
  browser_screenshot: z.object({ fullPage: z.boolean().optional() }),
  browser_log: z.object({ since: z.number().int().nonnegative().optional() }),
  browser_network: z.object({
    since: z.number().int().nonnegative().optional(),
    urlContains: z.string().optional(),
    limit: z.number().int().positive().max(MAX_NETWORK_LIMIT).default(DEFAULT_NETWORK_LIMIT),
  }),
  browser_response_body: z.object({
    requestId: z.string().min(1),
    offset: z.number().int().nonnegative().optional(),
    maxBytes: z.number().int().positive().max(MAX_BODY_BYTES).optional(),
  }),
  browser_rewrite_rules: z.object({ rules: z.array(ruleSchema) }),
  browser_upload: z.object({ ref: z.string().min(1), paths: z.array(z.string().min(1)).min(1) }),
  browser_mouse: z.object({
    action: z.enum(['move', 'click', 'double', 'down', 'up', 'wheel']),
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
  }),
  browser_drag: z.object({
    from: target,
    to: target,
    steps: z.number().int().positive().max(200).default(DEFAULT_DRAG_STEPS),
  }),
  browser_emulate: z.object({
    userAgent: nullable(z.string()),
    userAgentMetadata: nullable(userAgentMetadata),
    geolocation: nullable(
      z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().positive().optional() }),
    ),
    locale: nullable(z.string()),
    timezone: nullable(z.string()),
  }),
  browser_ask_operator: z.object({
    message: z.string().min(1),
    timeoutSec: z
      .number()
      .positive()
      .default(DEFAULT_ASK_TIMEOUT_SEC)
      .transform((sec) => Math.min(sec, MAX_ASK_TIMEOUT_SEC)),
  }),
} as const satisfies Record<BrowserToolName, z.ZodType>

/** The tools that forward to the browser; browser_ask_operator is engine only. */
const ACTION: Record<Exclude<BrowserToolName, 'browser_ask_operator'>, BrowserAction> = {
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
  browser_network: 'network',
  browser_response_body: 'response_body',
  browser_rewrite_rules: 'rewrite',
  browser_upload: 'upload',
  browser_mouse: 'mouse',
  browser_drag: 'drag',
  browser_emulate: 'emulate',
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
    const item = registry.browserFor(sessionId)

    if (name === 'browser_ask_operator') {
      // No activity mark: the page is the operator's while the agent waits.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Number(parsed.timeoutSec) * 1000)
      // A caller that hangs up stops waiting, so a later answer is kept for its next call.
      const signal = caller.signal === undefined ? ctrl.signal : AbortSignal.any([ctrl.signal, caller.signal])
      try {
        const answer = await registry.ask(item.id, String(parsed.message), signal)
        return answer.answered || answer.reason === 'closed' ? answer : { ...answer, pending: true }
      } finally {
        clearTimeout(timer)
      }
    }

    if (name === 'browser_upload') {
      // Relative paths mean the engagement root; main only ever sees absolute ones.
      const paths = (parsed.paths as string[]).map((p) => resolve(project.root, p))
      for (const path of paths) if (!existsSync(path)) throw new Error(`No such file: ${path}`)
      parsed.paths = paths
    }

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
      case 'browser_network':
        return { entries: result.entries ?? [], next: result.next ?? 0 }
      case 'browser_response_body':
        return {
          body: result.body ?? '',
          base64Encoded: result.base64Encoded === true,
          truncated: result.truncated === true,
          totalBytes: typeof result.totalBytes === 'number' ? result.totalBytes : 0,
          offset: typeof result.offset === 'number' ? result.offset : 0,
          ...(typeof result.nextOffset === 'number' ? { nextOffset: result.nextOffset } : {}),
        }
      case 'browser_rewrite_rules':
        return { rules: result.rules ?? [] }
      case 'browser_upload':
      case 'browser_mouse':
      case 'browser_drag':
        return { url: url ?? '', title: title ?? '' }
      case 'browser_emulate':
        return { emulation: result.emulation ?? {} }
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
