import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-filesroutes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${TOKEN}` }

describe('files routes', () => {
  it('lists directory entries directories-first with correct types', async () => {
    writeFileSync(join(root, 'notes.txt'), 'hello world')
    mkdirSync(join(root, 'sub'))

    const res = await app.request('/api/files', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      path: string
      entries: Array<{ name: string; type: 'file' | 'dir' }>
    }
    expect(body.path).toBe('')
    const names = body.entries.map((e) => e.name)
    // the sub dir comes before the file, and both are present
    expect(names.indexOf('sub')).toBeLessThan(names.indexOf('notes.txt'))
    expect(body.entries.find((e) => e.name === 'sub')?.type).toBe('dir')
    expect(body.entries.find((e) => e.name === 'notes.txt')?.type).toBe('file')
  })

  it('reads a file back', async () => {
    writeFileSync(join(root, 'notes.txt'), 'hello world')
    const res = await app.request('/api/files/read?path=notes.txt', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; content: string; truncated: boolean }
    expect(body.content).toBe('hello world')
    expect(body.truncated).toBe(false)
    expect(body.path).toBe('notes.txt')
  })

  it('rejects a path-traversal attempt with 400', async () => {
    const res = await app.request('/api/files/read?path=../../etc/passwd', { headers: auth })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid path')
  })

  it('404s a missing directory listing', async () => {
    const res = await app.request('/api/files?path=nope', { headers: auth })
    expect(res.status).toBe(404)
  })

  it('guards the routes behind the bearer token', async () => {
    const res = await app.request('/api/files')
    expect(res.status).toBe(401)
  })

  it('writes a file and reads it back', async () => {
    writeFileSync(join(root, 'notes.txt'), 'old')
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'notes.txt', content: 'brand new body' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; ok: boolean }
    expect(body).toMatchObject({ path: 'notes.txt', ok: true })
    // On disk, and back through the read route.
    expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('brand new body')
    const read = await app.request('/api/files/read?path=notes.txt', { headers: auth })
    expect(((await read.json()) as { content: string }).content).toBe('brand new body')
  })

  it('creates a new file inside an existing directory', async () => {
    mkdirSync(join(root, 'docs'))
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'docs/fresh.md', content: '# hi' }),
    })
    expect(res.status).toBe(200)
    expect(readFileSync(join(root, 'docs', 'fresh.md'), 'utf8')).toBe('# hi')
  })

  it('rejects a write into a non-existent directory tree', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'nope/deep/tree.txt', content: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid path')
  })

  it('rejects a path-traversal write with 400 and writes nothing', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '../../etc/pwned', content: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid path')
  })

  describe('through a symlink that leaves the engagement', () => {
    let outside: string

    beforeEach(() => {
      outside = mkdtempSync(join(tmpdir(), 'exe-outside-'))
      writeFileSync(join(outside, 'secret.txt'), 'not yours')
      symlinkSync(outside, join(root, 'escape'))
      symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'))
    })

    afterEach(() => {
      rmSync(outside, { recursive: true, force: true })
    })

    it('refuses to read a file behind a linked directory', async () => {
      const res = await app.request('/api/files/read?path=escape/secret.txt', { headers: auth })
      expect(res.status).toBe(400)
    })

    it('refuses to read a linked file', async () => {
      const res = await app.request('/api/files/read?path=leak.txt', { headers: auth })
      expect(res.status).toBe(400)
    })

    it('refuses to list a linked directory', async () => {
      const res = await app.request('/api/files?path=escape', { headers: auth })
      expect(res.status).toBe(400)
    })

    it('refuses to write through a link and leaves the outside file alone', async () => {
      const overwrite = await app.request('/api/files', {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'leak.txt', content: 'pwned' }),
      })
      expect(overwrite.status).toBe(400)
      const create = await app.request('/api/files', {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'escape/new.txt', content: 'pwned' }),
      })
      expect(create.status).toBe(400)
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('not yours')
      expect(existsSync(join(outside, 'new.txt'))).toBe(false)
    })

    it('still follows a link that stays inside the engagement', async () => {
      mkdirSync(join(root, 'real'))
      writeFileSync(join(root, 'real', 'a.txt'), 'inside')
      symlinkSync(join(root, 'real'), join(root, 'alias'))
      const res = await app.request('/api/files/read?path=alias/a.txt', { headers: auth })
      expect(res.status).toBe(200)
    })
  })

  it('rejects a null write body without a server error', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: 'null',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid write body', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'notes.txt' }),
    })
    expect(res.status).toBe(400)
  })

  it('guards the write route behind the bearer token', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'notes.txt', content: 'x' }),
    })
    expect(res.status).toBe(401)
  })
  it('stats a file', async () => {
    writeFileSync(join(root, 'notes.txt'), 'hello world')
    const res = await app.request('/api/files/stat?path=notes.txt', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; mtimeMs: number; size: number }
    expect(body.path).toBe('notes.txt')
    expect(body.size).toBe(11)
    expect(body.mtimeMs).toBeGreaterThan(0)
  })

  it('rejects a stat path-traversal attempt with 400', async () => {
    const res = await app.request('/api/files/stat?path=../../etc/passwd', { headers: auth })
    expect(res.status).toBe(400)
  })

  it('returns 404 when stat targets a missing file', async () => {
    const res = await app.request('/api/files/stat?path=nope.txt', { headers: auth })
    expect(res.status).toBe(404)
  })

  it('returns 400 when stat targets a directory', async () => {
    mkdirSync(join(root, 'sub'))
    const res = await app.request('/api/files/stat?path=sub', { headers: auth })
    expect(res.status).toBe(400)
  })

  it('guards the stat route behind the bearer token', async () => {
    writeFileSync(join(root, 'notes.txt'), 'hello world')
    const res = await app.request('/api/files/stat?path=notes.txt')
    expect(res.status).toBe(401)
  })

  it('returns the stat alongside file content on read', async () => {
    writeFileSync(join(root, 'notes.txt'), 'hello world')
    const res = await app.request('/api/files/read?path=notes.txt', { headers: auth })
    const body = (await res.json()) as { mtimeMs: number; size: number }
    expect(body.size).toBe(11)
    expect(body.mtimeMs).toBeGreaterThan(0)
  })

  it('returns the post-write stat, matching a subsequent stat call', async () => {
    const res = await app.request('/api/files', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'written.txt', content: 'abc' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; mtimeMs: number; size: number }
    expect(body.ok).toBe(true)
    expect(body.size).toBe(3)

    const after = await app.request('/api/files/stat?path=written.txt', { headers: auth })
    const afterBody = (await after.json()) as { mtimeMs: number; size: number }
    expect(afterBody.mtimeMs).toBe(body.mtimeMs)
    expect(afterBody.size).toBe(body.size)
  })
})
