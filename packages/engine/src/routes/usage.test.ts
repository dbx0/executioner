import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import {
  computeUsage,
  contextWindowFor,
  estimateCostUsd,
  normalizeModelForPricing,
} from './usage.js'
import { encodeProjectDir } from './sessions.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-usageroutes-'))
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

function assistant(props: {
  ts: string
  model: string
  id: string
  requestId: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: props.ts,
    requestId: props.requestId,
    message: {
      id: props.id,
      model: props.model,
      usage: {
        input_tokens: props.input,
        output_tokens: props.output,
        cache_read_input_tokens: props.cacheRead,
        cache_creation_input_tokens: props.cacheWrite,
        cache_creation: { ephemeral_1h_input_tokens: props.cacheWrite1h ?? 0 },
      },
    },
  })
}

describe('computeUsage', () => {
  it('aggregates tokens, cost, and context% from a synthetic transcript', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      assistant({
        ts: '2026-01-01T10:00:00.000Z',
        model: 'claude-sonnet-4-5',
        id: 'm1',
        requestId: 'r1',
        input: 100,
        output: 200,
        cacheRead: 1000,
        cacheWrite: 50,
      }),
      assistant({
        ts: '2026-01-01T10:05:00.000Z',
        model: 'claude-sonnet-4-5',
        id: 'm2',
        requestId: 'r2',
        input: 300,
        output: 400,
        cacheRead: 5000,
        cacheWrite: 100,
      }),
    ].join('\n')

    const usage = computeUsage(jsonl, Date.parse('2026-01-01T11:00:00.000Z'))

    expect(usage.model).toBe('claude-sonnet-4-5')
    expect(usage.turnCount).toBe(2)
    expect(usage.tokens.input).toBe(400)
    expect(usage.tokens.output).toBe(600)
    expect(usage.tokens.cacheRead).toBe(6000)
    expect(usage.tokens.cacheWrite).toBe(150)
    expect(usage.tokens.total).toBe(400 + 600 + 6000 + 150)

    // Cost = sum over pools at sonnet-4-5 base rates ($/1M): 3, 15, 0.3, 3.75.
    const expectedCost =
      (400 * 3 + 600 * 15 + 6000 * 0.3 + 150 * 3.75) / 1_000_000
    expect(usage.costUsd).toBeCloseTo(expectedCost, 10)

    // Context = last turn's input + cacheRead + cacheWrite against a 1M window.
    expect(usage.context.used).toBe(300 + 5000 + 100)
    expect(usage.context.limit).toBe(1_000_000)
    expect(usage.context.percent).toBeCloseTo((5400 / 1_000_000) * 100, 10)

    // Both turns fall in one active 5-hour block.
    expect(usage.block).not.toBeNull()
    expect(usage.block?.isActive).toBe(true)
    expect(usage.block?.tokens).toBe(usage.tokens.total)
  })

  it('dedupes repeated rows for the same message/request id, keeping the max', () => {
    const jsonl = [
      assistant({
        ts: '2026-01-01T10:00:00.000Z',
        model: 'claude-opus-4-8',
        id: 'm1',
        requestId: 'r1',
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
      }),
      assistant({
        ts: '2026-01-01T10:00:00.000Z',
        model: 'claude-opus-4-8',
        id: 'm1',
        requestId: 'r1',
        input: 100,
        output: 250,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ].join('\n')
    const usage = computeUsage(jsonl)
    expect(usage.turnCount).toBe(1)
    expect(usage.tokens.output).toBe(250)
  })

  it('returns an empty state for a transcript with no usage rows', () => {
    const usage = computeUsage(JSON.stringify({ type: 'user', message: { content: 'x' } }))
    expect(usage.model).toBeNull()
    expect(usage.tokens.total).toBe(0)
    expect(usage.costUsd).toBeNull()
    expect(usage.block).toBeNull()
  })
})

describe('pricing helpers', () => {
  it('normalizes model ids to the pricing table keys', () => {
    expect(normalizeModelForPricing('claude-opus-4-8-20260101')).toBe('claude-opus-4-8')
    expect(normalizeModelForPricing('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(normalizeModelForPricing('gpt-4o')).toBeNull()
  })

  it('uses a 1M window for sonnet-4 family, 200k otherwise', () => {
    expect(contextWindowFor('claude-sonnet-4-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-opus-4-8')).toBe(200_000)
    expect(contextWindowFor(null)).toBe(200_000)
  })

  it('returns null cost for an unknown model', () => {
    expect(estimateCostUsd('mystery-model', 1000, 1000, 0, 0)).toBeNull()
  })
})

describe('usage route', () => {
  it('parses a transcript under the engagement projects dir', async () => {
    const dir = join(os.homedir(), '.claude', 'projects', encodeProjectDir(root))
    mkdirSync(dir, { recursive: true })
    const id = 'session-under-test'
    writeFileSync(
      join(dir, `${id}.jsonl`),
      assistant({
        ts: '2026-01-01T10:00:00.000Z',
        model: 'claude-opus-4-8',
        id: 'm1',
        requestId: 'r1',
        input: 100,
        output: 200,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    )
    try {
      const res = await app.request(`/api/usage?session=${id}`, { headers: auth })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { model: string; tokens: { total: number } }
      expect(body.model).toBe('claude-opus-4-8')
      expect(body.tokens.total).toBe(300)
    } finally {
      rmSync(join(dir, `${id}.jsonl`), { force: true })
    }
  })

  it('returns an empty state when no session is given', async () => {
    const res = await app.request('/api/usage', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { model: string | null }
    expect(body.model).toBeNull()
  })

  it('rejects path traversal in the session id', async () => {
    const res = await app.request('/api/usage?session=../../etc/passwd', { headers: auth })
    expect(res.status).toBe(400)
  })

  it('guards the route behind the bearer token', async () => {
    const res = await app.request('/api/usage?session=x')
    expect(res.status).toBe(401)
  })
})
