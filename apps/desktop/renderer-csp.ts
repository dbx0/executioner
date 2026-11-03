/**
 * The renderer's Content-Security-Policy. Scripts come only from the bundle, so
 * text that reaches the page (a finding, a file, an agent's markdown) can never
 * run as code; the network is the loopback engine and nothing else, apart from
 * the favicon service the secrets list shows logos from. Styles allow inline
 * because React style props and Monaco both set them.
 *
 * connect-src 'self' covers Host RPC when the portable UI is served from
 * team-server; loopback entries cover the per-engagement engine.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
