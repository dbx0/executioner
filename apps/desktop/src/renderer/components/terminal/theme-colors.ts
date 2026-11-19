/**
 * Reads theme tokens as concrete colors for the two canvases that cannot take a
 * CSS variable: xterm and Monaco. Both want a literal color (Monaco only a hex),
 * while several tokens are `color-mix()` expressions, so a token is resolved
 * through the browser and then normalised to `#rrggbb` / `#rrggbbaa`.
 */

const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)))
const hex2 = (n: number): string => clamp255(n).toString(16).padStart(2, '0')

function formatHex(r: number, g: number, b: number, a: number): string {
  const rgb = `#${hex2(r)}${hex2(g)}${hex2(b)}`
  return a >= 1 ? rgb : `${rgb}${hex2(a * 255)}`
}

/** A channel or alpha written as a number or a percentage, as a fraction of `whole`. */
function channel(raw: string, whole: number): number {
  return raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * whole : Number.parseFloat(raw)
}

/**
 * Normalise a computed CSS color to hex. Handles the forms a browser serialises
 * a color to: hex, `rgb()` / `rgba()` (comma or space separated) and
 * `color(srgb r g b / a)`, which is what a `color-mix()` computes to. Anything
 * else returns null so the caller can leave that color at its default.
 */
export function toHex(css: string): string | null {
  const value = css.trim().toLowerCase()
  if (value === '') return null
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1]
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) return `#${[...hex].map((c) => c + c).join('')}`
    return hex.length === 6 || hex.length === 8 ? `#${hex}` : null
  }
  const fn = /^(rgba?|color)\(([^)]+)\)$/.exec(value)
  if (fn === null) return null
  const parts = (fn[2] ?? '').split(/[\s,/]+/).filter((p) => p !== '')
  if (fn[1] === 'color') {
    if (parts[0] !== 'srgb' || parts.length < 4) return null
    const [r, g, b] = parts.slice(1, 4).map((p) => channel(p, 1) * 255)
    const a = parts[4] === undefined ? 1 : channel(parts[4], 1)
    return [r, g, b, a].some((n) => n === undefined || Number.isNaN(n)) ? null : formatHex(r!, g!, b!, a)
  }
  if (parts.length < 3) return null
  const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255))
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1)
  return [r, g, b, a].some((n) => n === undefined || Number.isNaN(n)) ? null : formatHex(r!, g!, b!, a)
}

/**
 * The current value of a color token (`--background`, `--glass-active`) as hex,
 * or null when it is not set or not a color. A plain token is read straight off
 * the root; an expression is resolved by letting the browser compute it on a
 * throwaway element.
 */
export function tokenHex(name: string): string | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement
  const direct = toHex(getComputedStyle(root).getPropertyValue(name))
  if (direct !== null) return direct
  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = `var(${name})`
  root.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return toHex(computed)
}

/** Build an object from token names, leaving out every key whose token did not resolve. */
export function tokenColors<K extends string>(map: Record<K, string>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const key of Object.keys(map) as K[]) {
    const color = tokenHex(map[key])
    if (color !== null) out[key] = color
  }
  return out
}
