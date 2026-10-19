import { realpathSync } from 'node:fs'
import path from 'node:path'

/** True when `abs` is `root` itself or lies beneath it. Both must be absolute. */
export function isWithin(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
}

/** The real path of `abs`, or of its nearest existing ancestor when it does not exist yet. */
function realExisting(abs: string): string {
  let current = abs
  for (;;) {
    try {
      const real = realpathSync(current)
      // Re-attach the part that does not exist yet; it cannot be a link.
      return current === abs ? real : path.join(real, path.relative(current, abs))
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return abs
      current = parent
    }
  }
}

/**
 * Resolve a client-supplied path against `root` and confirm it stays inside,
 * both as written and once symlinks are followed. A lexical check alone lets a
 * link inside the root (a cloned repo, a tool's output, an agent's work) point
 * a read or a write anywhere on the machine. Returns the absolute path and the
 * normalised relative one, or null when the path escapes.
 */
export function confinePath(root: string, requested: string): { abs: string; rel: string } | null {
  const base = path.resolve(root)
  const abs = path.resolve(base, requested)
  if (!isWithin(base, abs)) return null
  if (!isWithin(realExisting(base), realExisting(abs))) return null
  return { abs, rel: abs === base ? '' : path.relative(base, abs) }
}

/**
 * Like {@link confinePath}, for a path that arrives absolute (one a tool wrote
 * into a fact). Relative paths are refused rather than guessed at.
 */
export function confineAbsolute(root: string, candidate: string): string | null {
  if (!path.isAbsolute(candidate)) return null
  return confinePath(root, candidate)?.abs ?? null
}
