import type { BrowserCall } from '@exe/protocol'

/** How long a rebuilt page may spend reloading its old address before the call goes ahead anyway. */
export const CRASH_RELOAD_TIMEOUT_MS = 10_000

/**
 * The address a page rebuilt after a crash should reload before running `call`, or undefined
 * for none: a call that navigates replaces the page anyway, and only web addresses come back
 * (a chrome:// page, such as the one that crashed it, would only crash or hang again).
 */
export function crashReloadUrl(url: string, call: Pick<BrowserCall, 'action' | 'args'>): string | undefined {
  if (call.action === 'navigate') return undefined
  const args = (call.args ?? {}) as { url?: unknown }
  if (call.action === 'ensure' && typeof args.url === 'string' && args.url !== '') return undefined
  return /^(https?|file):/i.test(url) ? url : undefined
}
