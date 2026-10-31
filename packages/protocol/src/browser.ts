/** The actions the engine can ask the desktop's embedded browser to perform. */
export const BROWSER_ACTIONS = [
  'ensure',
  'navigate',
  'back',
  'forward',
  'reload',
  'snapshot',
  'click',
  'type',
  'press',
  'select',
  'eval',
  'wait',
  'screenshot',
  'log',
  'network',
  'response_body',
  'rewrite',
  'upload',
  'mouse',
  'drag',
  'emulate',
  'close',
] as const

export type BrowserAction = (typeof BROWSER_ACTIONS)[number]

export type DialogChoice = 'accept' | 'dismiss'

/**
 * One call from the engine to the desktop host. `agent: false` marks an
 * operator-driven call (address bar) that main must not count toward the agent
 * dialog window.
 */
export interface BrowserCall {
  id: string
  browserId: string
  action: BrowserAction
  args: Record<string, unknown>
  agent: boolean
}

export type BrowserReply = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string }

export const BROWSER_APP_CLOSED = 'The browser needs the Executioner app open on this engagement.'
export const STALE_REF = 'stale reference, take a new snapshot'
