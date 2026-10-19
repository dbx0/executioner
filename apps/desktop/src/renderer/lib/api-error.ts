/**
 * A user-friendly message for an axios error. A 404 on a right-sidebar/inspection
 * route usually means an older engine (without the route) is still running — a
 * restart fixes it — so we say that instead of surfacing the raw axios string.
 */
export function friendlyError(e: unknown, fallback: string): string {
  const status = (e as { response?: { status?: number } })?.response?.status
  if (status === 404) return 'Restart the app to enable this panel.'
  return fallback
}

/**
 * The most useful sentence available for a failed API call.
 *
 * Axios reports the transport ("Request failed with status code 400"), which
 * tells an operator nothing about what to fix. The engine sends the reason in
 * the body — that a value was a wildcard, that a rule names no asset — so that
 * is what should reach the screen, with the transport error as the fallback.
 */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (typeof error !== 'object' || error === null) return fallback

  const response = (error as { response?: { data?: unknown } }).response
  const data = response?.data
  if (typeof data === 'object' && data !== null) {
    const body = data as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
    if (typeof body.message === 'string' && body.message.length > 0) return body.message
  }

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}
