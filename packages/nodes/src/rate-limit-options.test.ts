import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArgv } from './command.js'
import { resolveParams } from './params.js'
import { bundledManifestsDir } from './registry.js'
import { loadManifestFromToml } from './toml.js'

const manifestsDir = bundledManifestsDir()

function argvFor(id: string, params: Record<string, unknown>): string[] {
  const manifest = loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8'))
  const resolved = resolveParams(manifest, params)
  return buildArgv(manifest, { target: { value: 'target.tld' }, params: resolved }).args
}

function paramsOf(id: string) {
  return loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8')).params
}

describe('katana rate limiting', () => {
  it('declares an optional rate_limit param', () => {
    expect(paramsOf('katana').rate_limit).toMatchObject({ type: 'number' })
  })

  it('omits -rl when no rate_limit is set', () => {
    expect(argvFor('katana', {})).not.toContain('-rl')
  })

  it('passes -rl <n> when a rate_limit is set', () => {
    const args = argvFor('katana', { rate_limit: 150 })
    expect(args).toContain('-rl')
    expect(args[args.indexOf('-rl') + 1]).toBe('150')
  })
})

describe('whatweb pacing', () => {
  it('declares optional wait and max_threads params', () => {
    const p = paramsOf('whatweb')
    expect(p.wait).toMatchObject({ type: 'number' })
    expect(p.max_threads).toMatchObject({ type: 'number' })
  })

  it('omits --wait and --max-threads when unset', () => {
    const args = argvFor('whatweb', {})
    expect(args).not.toContain('--wait')
    expect(args).not.toContain('--max-threads')
  })

  it('passes --wait and --max-threads when set', () => {
    const args = argvFor('whatweb', { wait: 2, max_threads: 5 })
    expect(args[args.indexOf('--wait') + 1]).toBe('2')
    expect(args[args.indexOf('--max-threads') + 1]).toBe('5')
  })
})

// A bug bounty programme commonly requires an identifying request header and a
// request rate cap. Both have to be settable on the node, or the operator is
// pushed back to a script to stay inside the rules.
describe.each(['httpx', 'nuclei'])('%s programme rules', (id) => {
  it('sends nothing extra by default', () => {
    const args = argvFor(id, {})
    expect(args).not.toContain('-H')
    expect(args).not.toContain('-rl')
  })

  it('passes -H with the header as one argument', () => {
    const args = argvFor(id, { header: 'X-Bug-Hunter: alice' })
    expect(args[args.indexOf('-H') + 1]).toBe('X-Bug-Hunter: alice')
  })

  it('passes -rl <n> when a rate_limit is set', () => {
    const args = argvFor(id, { rate_limit: 1 })
    expect(args[args.indexOf('-rl') + 1]).toBe('1')
  })
})

describe('whatweb request header', () => {
  it('omits --header by default and passes it when set', () => {
    expect(argvFor('whatweb', {})).not.toContain('--header')
    const args = argvFor('whatweb', { header: 'X-Bug-Hunter:alice' })
    expect(args[args.indexOf('--header') + 1]).toBe('X-Bug-Hunter:alice')
  })
})
