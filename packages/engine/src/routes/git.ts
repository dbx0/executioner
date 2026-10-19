import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { Hono } from 'hono'
import type { Project } from '@exe/project'
import { confinePath } from '../infra/confine.js'

/**
 * Read-only git inspection for the engagement directory. Mounted under the
 * bearer-guarded /api router. Every endpoint degrades gracefully when the root
 * is not a git repository (isRepo: false, empty data, status 200), and never
 * shells out to anything but the local `git` binary scoped to project.root.
 */
export function gitRoutes(project: Project): Hono {
  const app = new Hono()
  const root = path.resolve(project.root)

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 })

  const isRepo = (): boolean => {
    try {
      return git(['rev-parse', '--is-inside-work-tree']).trim() === 'true'
    } catch {
      return false
    }
  }

  app.get('/git/status', (c) => {
    if (!isRepo()) return c.json({ isRepo: false, branch: null, files: [] })

    let out: string
    try {
      out = git(['status', '--porcelain=v1', '-b'])
    } catch {
      return c.json({ isRepo: false, branch: null, files: [] })
    }

    let branch: string | null = null
    const files: Array<{ path: string; x: string; y: string }> = []
    for (const line of out.split('\n')) {
      if (line === '') continue
      if (line.startsWith('## ')) {
        const header = line.slice(3)
        if (header.startsWith('HEAD (no branch)')) {
          branch = null
        } else if (header.startsWith('No commits yet on ')) {
          branch = header.slice('No commits yet on '.length).trim()
        } else {
          const sep = header.indexOf('...')
          branch = (sep === -1 ? header : header.slice(0, sep)).trim()
        }
        continue
      }
      const x = line[0] ?? ' '
      const y = line[1] ?? ' '
      let file = line.slice(3)
      const arrow = file.indexOf(' -> ')
      if (arrow !== -1) file = file.slice(arrow + 4)
      files.push({ path: file, x, y })
    }

    return c.json({ isRepo: true, branch, files })
  })

  app.get('/git/log', (c) => {
    if (!isRepo()) return c.json({ isRepo: false, commits: [] })

    const raw = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isNaN(raw) ? 50 : Math.min(200, Math.max(1, raw))

    let out: string
    try {
      out = git(['log', '-n', String(limit), '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI'])
    } catch {
      return c.json({ isRepo: true, commits: [] })
    }

    const commits = out
      .split('\n')
      .filter((l) => l !== '')
      .map((line) => {
        const [hash = '', shortHash = '', subject = '', author = '', date = ''] = line.split('\x1f')
        return { hash, shortHash, subject, author, date }
      })

    return c.json({ isRepo: true, commits })
  })

  app.get('/git/diff', (c) => {
    const CAP = 200_000
    const requested = c.req.query('path') ?? ''

    // A leading ':' is pathspec magic (`:/x` names the repo top), which a root
    // check on the literal text would not see coming.
    if (requested !== '' && (requested.startsWith(':') || confinePath(root, requested) === null)) {
      return c.json({ error: 'invalid path' }, 400)
    }

    if (!isRepo()) return c.json({ isRepo: false, path: requested, diff: '' })

    const args = requested === '' ? [] : ['--', requested]
    let diff: string
    try {
      diff = git(['diff', ...args])
      if (diff === '') diff = git(['diff', '--staged', ...args])
    } catch {
      diff = ''
    }

    if (diff.length > CAP) diff = diff.slice(0, CAP)
    return c.json({ isRepo: true, path: requested, diff })
  })

  return app
}
