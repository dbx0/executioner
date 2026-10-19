import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import { encodeProjectDir, summarizeTranscript } from './sessions.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-sessionroutes-'))
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

describe('session routes', () => {
  it('degrades to an empty list when no transcripts exist', async () => {
    const res = await app.request('/api/sessions', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: unknown[] }
    expect(body.sessions).toEqual([])
  })

  it('guards the route behind the bearer token', async () => {
    const res = await app.request('/api/sessions')
    expect(res.status).toBe(401)
  })
})

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeProjectDir('/private/tmp/ai-research')).toBe('-private-tmp-ai-research')
  })
})

describe('summarizeTranscript', () => {
  it('extracts the first user text and counts user/assistant messages', () => {
    const jsonl = [
      JSON.stringify({ type: 'summary', message: { content: 'ignored' } }),
      JSON.stringify({ type: 'user', message: { content: '<command-name>/init</command-name>' } }),
      JSON.stringify({ type: 'user', message: { content: '  Find   the bug  ' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
      'not json at all',
    ].join('\n')

    const { firstPrompt, messageCount } = summarizeTranscript(jsonl)
    expect(firstPrompt).toBe('Find the bug')
    expect(messageCount).toBe(3)
  })

  it('resolves array text content for the first prompt', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'hello there' }] },
    })
    expect(summarizeTranscript(jsonl).firstPrompt).toBe('hello there')
  })
})
