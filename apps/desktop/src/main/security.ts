/**
 * The window's trust boundary, as pure functions so it can be tested without
 * Electron. The renderer holds the engine's bearer token, and the token opens a
 * shell, so nothing but the app's own page may run in that window or speak to
 * the main process.
 */

/**
 * True when `url` is the app's own page: the same origin as the dev server it
 * was loaded from, or, when packaged, the very file it was loaded from. A hash
 * route on that page still counts.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  let candidate: URL
  let app: URL
  try {
    candidate = new URL(url)
    app = new URL(appUrl)
  } catch {
    return false
  }
  if (app.protocol === 'file:') return candidate.protocol === 'file:' && candidate.pathname === app.pathname
  return candidate.origin === app.origin
}

/**
 * The URL to hand to the operating system's browser, or null when it should not
 * leave the app at all. Only web links go out: `file:`, `javascript:`, custom
 * schemes and anything that does not parse would otherwise launch whatever the
 * desktop has registered for them.
 */
export function externalUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

/** The browser permissions the app actually uses: desktop notifications and clipboard writes. */
const GRANTED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write'])

/** Whether to grant a renderer permission request; everything else is refused. */
export function allowPermission(permission: string, requestingUrl: string, appUrl: string): boolean {
  return GRANTED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl, appUrl)
}
