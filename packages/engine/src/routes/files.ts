import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import { confinePath } from '../infra/confine.js'

/** What PUT /files takes: a path inside the engagement and its new text. */
const writeSchema = z.object({ path: z.string().min(1), content: z.string() })

/**
 * Read-only file browser rooted at the engagement directory. Mounted under the
 * bearer-guarded /api router. Every path is resolved against project.root and
 * rejected if it escapes the root, as written or through a symlink, so the
 * client can never read or write outside the engagement folder.
 */
export function filesRoutes(project: Project): Hono {
  const app = new Hono()
  const root = path.resolve(project.root)

  const resolve = (rel: string): { abs: string; rel: string } | null => confinePath(root, rel)

  app.get('/files', (c) => {
    const requested = c.req.query('path') ?? ''
    const target = resolve(requested)
    if (target === null) return c.json({ error: 'invalid path' }, 400)

    let dirents
    try {
      const stat = statSync(target.abs)
      if (!stat.isDirectory()) return c.json({ error: 'not found' }, 404)
      dirents = readdirSync(target.abs, { withFileTypes: true })
    } catch {
      return c.json({ error: 'not found' }, 404)
    }

    const entries = dirents
      .map((d) => {
        try {
          const type: 'file' | 'dir' = d.isDirectory() ? 'dir' : 'file'
          return { name: d.name, type }
        } catch {
          return null
        }
      })
      .filter((e): e is { name: string; type: 'file' | 'dir' } => e !== null)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })

    return c.json({ path: target.rel, entries })
  })

  app.get('/files/read', (c) => {
    const CAP = 200_000
    const requested = c.req.query('path') ?? ''
    if (requested === '') return c.json({ error: 'not found' }, 404)
    const target = resolve(requested)
    if (target === null) return c.json({ error: 'invalid path' }, 400)

    let stat
    try {
      stat = statSync(target.abs)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    if (stat.isDirectory()) return c.json({ error: 'not a file' }, 400)

    let content
    try {
      content = readFileSync(target.abs, 'utf8')
    } catch {
      return c.json({ error: 'not found' }, 404)
    }

    const truncated = content.length > CAP
    if (truncated) content = content.slice(-CAP)
    return c.json({
      path: target.rel,
      content,
      truncated,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    })
  })

  /**
   * Cheap change hint for an open editor tab: mtime and size without reading the
   * bytes. Guarded exactly like /files/read — the client polls this while a file
   * is open, so it must stay as cheap as a stat call and never leak outside the
   * engagement root.
   */
  app.get('/files/stat', (c) => {
    const requested = c.req.query('path') ?? ''
    if (requested === '') return c.json({ error: 'not found' }, 404)
    const target = resolve(requested)
    if (target === null) return c.json({ error: 'invalid path' }, 400)

    let stat
    try {
      stat = statSync(target.abs)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    if (stat.isDirectory()) return c.json({ error: 'not a file' }, 400)

    return c.json({ path: target.rel, mtimeMs: stat.mtimeMs, size: stat.size })
  })

  /**
   * Write a text file back into the engagement. The path is resolved and
   * root-guarded exactly like the read route (traversal escapes are rejected).
   * We refuse to write over a directory, and refuse to create arbitrary new
   * trees: the target's parent directory must already exist (so writing a brand
   * new file into an existing folder is fine, but scattering nested paths is not).
   */
  app.put('/files', async (c) => {
    const parsed = writeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400)
    const target = resolve(parsed.data.path)
    const { content } = parsed.data
    if (target === null) return c.json({ error: 'invalid path' }, 400)

    try {
      // Overwriting an existing file is fine; overwriting a directory is not.
      if (statSync(target.abs).isDirectory()) return c.json({ error: 'not a file' }, 400)
    } catch {
      // The file doesn't exist yet — allowed only when its parent dir already does.
      const parent = path.dirname(target.abs)
      try {
        if (!statSync(parent).isDirectory()) return c.json({ error: 'invalid path' }, 400)
      } catch {
        return c.json({ error: 'invalid path' }, 400)
      }
    }

    let written
    try {
      writeFileSync(target.abs, content, 'utf8')
      // The client rebaselines its changed-on-disk detection from this stat, so
      // it has to describe the bytes we just wrote — re-stat rather than reuse
      // any value read earlier.
      written = statSync(target.abs)
    } catch {
      return c.json({ error: 'write failed' }, 500)
    }
    return c.json({
      path: target.rel,
      ok: true,
      mtimeMs: written.mtimeMs,
      size: written.size,
    })
  })

  return app
}
