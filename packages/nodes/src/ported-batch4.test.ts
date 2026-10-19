import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TargetKind } from '@exe/protocol'
import { buildArgv } from './command.js'
import { resolveParams } from './params.js'
import { runGoldenCaseWithEmit, type GoldenCase } from './golden.js'
import { bundledManifestsDir, loadManifests } from './registry.js'
import { loadManifestFromToml } from './toml.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')
const manifestsDir = bundledManifestsDir()

const NEW_IDS = [
  'whois', 'dig', 'amass', 'wafw00f', 'dnsx', 'naabu',
  'httpx', 'whatweb', 'gobuster', 'ffuf', 'katana', 'sslscan',
]

function load(id: string) {
  return loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8'))
}

function argvFor(id: string, value: string, params: Record<string, unknown>): string[] {
  const manifest = load(id)
  return buildArgv(manifest, { target: { value }, params: resolveParams(manifest, params) }).args
}

function emitFor(id: string, fixture: string, kind: TargetKind, value: string) {
  const goldenCase: GoldenCase = {
    manifestFile: join(manifestsDir, `${id}.toml`),
    fixtureFile: join(fixturesDir, fixture),
    expectedRecords: [],
  }
  return runGoldenCaseWithEmit(goldenCase, {
    target: { id: 't1', kind, value },
    params: {},
    nodeId: id,
    executionId: 'e1',
  })
}

describe('batch 4 new tools load and validate', () => {
  for (const id of NEW_IDS) {
    it(`${id} loads as a valid manifest`, () => {
      expect(load(id).id).toBe(id)
    })
  }

  it('loadManifests picks up all batch-4 tools', () => {
    const manifests = loadManifests(manifestsDir)
    for (const id of NEW_IDS) expect(manifests.has(id)).toBe(true)
  })
})

describe('whois', () => {
  it('builds argv and parses whois into structured fields', () => {
    expect(argvFor('whois', 'example.com', {})).toEqual(['example.com'])
    const { facts } = emitFor('whois', 'whois-sample.txt', 'domain', 'example.com')
    expect(facts.map((f) => ({ kind: f.kind, data: f.data }))).toEqual([
      {
        kind: 'whois',
        data: {
          registrar: 'MarkMonitor Inc.',
          registrant: '',
          created: '1995-08-14T04:00:00Z',
          updated: '',
          expires: '2024-08-13T04:00:00Z',
          name_servers: 'a.iana-servers.net, b.iana-servers.net',
          status: '',
          dnssec: '',
          emails: '',
        },
      },
    ])
  })
})

describe('dig', () => {
  it('builds argv with the record type and emits child IP targets', () => {
    expect(argvFor('dig', 'example.com', { record_type: 'A' })).toEqual(['+short', 'A', 'example.com'])
    expect(argvFor('dig', 'example.com', { record_type: 'MX' })).toEqual(['+short', 'MX', 'example.com'])
    const { targets } = emitFor('dig', 'dig-sample.txt', 'domain', 'example.com')
    expect(targets.map((t) => ({ kind: t.kind, value: t.value }))).toEqual([
      { kind: 'ip', value: '93.184.216.34' },
      { kind: 'ip', value: '93.184.216.35' },
    ])
  })
})

describe('amass', () => {
  it('adds -passive only in passive mode and emits subdomains', () => {
    expect(argvFor('amass', 'example.com', { mode: 'passive' })).toEqual([
      'enum', '-d', 'example.com', '-passive',
    ])
    expect(argvFor('amass', 'example.com', { mode: 'active' })).toEqual(['enum', '-d', 'example.com'])
    const { targets } = emitFor('amass', 'amass-sample.txt', 'domain', 'example.com')
    expect(targets.map((t) => t.value)).toEqual([
      'www.example.com', 'api.example.com', 'mail.example.com',
    ])
    expect(targets.every((t) => t.kind === 'subdomain')).toBe(true)
  })
})

describe('wafw00f', () => {
  it('builds argv and parses the detected WAF', () => {
    expect(argvFor('wafw00f', 'https://example.com', {})).toEqual(['https://example.com'])
    const { facts } = emitFor('wafw00f', 'wafw00f-sample.txt', 'url', 'https://example.com')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.data).toEqual({ waf: 'Cloudflare (Cloudflare Inc.) WAF.', detected: 'true' })
  })
})

describe('dnsx', () => {
  it('builds argv with a record-type flag and parses resolved hosts', () => {
    expect(argvFor('dnsx', 'example.com', {})).toEqual([
      '-d', 'example.com', '-resp', '-json', '-silent', '-a',
    ])
    const { facts } = emitFor('dnsx', 'dnsx-sample.jsonl', 'domain', 'example.com')
    expect(facts.map((f) => f.data.host)).toEqual(['example.com', 'www.example.com'])
    expect(facts.every((f) => f.kind === 'raw_output')).toBe(true)
  })
})

describe('naabu', () => {
  it('builds argv with rate and emits ports', () => {
    expect(argvFor('naabu', '1.2.3.4', {})).toEqual([
      '-host', '1.2.3.4', '-json', '-silent', '-rate', '1000',
    ])
    expect(argvFor('naabu', '1.2.3.4', { ports: '80,443' })).toContain('-p')
    expect(argvFor('naabu', '1.2.3.4', { top_ports: 100 })).toEqual([
      '-host', '1.2.3.4', '-json', '-silent', '-rate', '1000', '-top-ports', '100',
    ])
    const { facts } = emitFor('naabu', 'naabu-sample.jsonl', 'ip', '1.2.3.4')
    expect(facts.map((f) => ({ port: f.data.port, host: f.data.host }))).toEqual([
      { port: '80', host: '93.184.216.34' },
      { port: '443', host: '93.184.216.34' },
    ])
    expect(facts.every((f) => f.kind === 'port')).toBe(true)
  })
})

describe('httpx', () => {
  it('probes a single target via -u and emits http services', () => {
    expect(argvFor('httpx', 'https://example.com', {})).toEqual([
      '-u', 'https://example.com', '-json', '-silent', '-nc',
    ])
    const { facts } = emitFor('httpx', 'httpx-sample.jsonl', 'url', 'https://example.com')
    expect(facts.map((f) => ({ url: f.data.url, status: f.data.status_code, title: f.data.title }))).toEqual([
      { url: 'https://example.com', status: '200', title: 'Example Domain' },
      { url: 'https://example.com/login', status: '302', title: 'Login' },
    ])
    expect(facts.every((f) => f.kind === 'http_service')).toBe(true)
  })
})

describe('whatweb', () => {
  it('builds argv and parses technology entries', () => {
    expect(argvFor('whatweb', 'https://example.com', {})).toEqual([
      '--quiet', '--log-json', '-', 'https://example.com',
    ])
    // One technology fact per detected plugin, named by the plugin key (nested plugins{} map).
    const { facts } = emitFor('whatweb', 'whatweb-sample.json', 'url', 'https://example.com')
    expect(facts.map((f) => f.data.name)).toEqual(['nginx', 'HTML5', 'WordPress'])
    expect(facts.every((f) => f.kind === 'technology')).toBe(true)
  })
})

describe('gobuster', () => {
  it('adds -x for extensions and parses discovered paths', () => {
    expect(argvFor('gobuster', 'https://example.com', {})).toEqual([
      'dir', '-u', 'https://example.com', '-w', '/usr/share/wordlists/dirb/common.txt',
      '-o', '/dev/stdout', '-t', '10',
    ])
    expect(argvFor('gobuster', 'https://example.com', { extensions: 'php,html' })).toContain('-x')
    const { facts } = emitFor('gobuster', 'gobuster-sample.txt', 'url', 'https://example.com')
    expect(facts.map((f) => ({ path: f.data.path, status: f.data.status }))).toEqual([
      { path: '/admin', status: '200' },
      { path: '/login.php', status: '302' },
      { path: '/robots.txt', status: '200' },
    ])
  })
})

describe('ffuf', () => {
  it('adds filter flags and emits url targets and http services', () => {
    expect(argvFor('ffuf', 'https://example.com/FUZZ', {})).toEqual([
      '-u', 'https://example.com/FUZZ', '-w', '/usr/share/wordlists/dirb/common.txt',
      '-of', 'json', '-o', '/dev/stdout', '-t', '40',
    ])
    expect(argvFor('ffuf', 'https://example.com/FUZZ', { filter_code: '404', filter_size: '0' }))
      .toEqual([
        '-u', 'https://example.com/FUZZ', '-w', '/usr/share/wordlists/dirb/common.txt',
        '-of', 'json', '-o', '/dev/stdout', '-t', '40', '-fc', '404', '-fs', '0',
      ])
    const { targets, facts } = emitFor('ffuf', 'ffuf-sample.json', 'url', 'https://example.com')
    expect(targets.map((t) => t.value)).toEqual([
      'https://example.com/admin', 'https://example.com/api',
    ])
    expect(facts.map((f) => ({ url: f.data.url, status: f.data.status }))).toEqual([
      { url: 'https://example.com/admin', status: '200' },
      { url: 'https://example.com/api', status: '401' },
    ])
  })
})

describe('katana', () => {
  it('adds -js-crawl when enabled and emits crawled urls', () => {
    expect(argvFor('katana', 'https://example.com', {})).toEqual([
      '-u', 'https://example.com', '-jsonl', '-silent', '-depth', '3', '-concurrency', '10',
    ])
    expect(argvFor('katana', 'https://example.com', { js_crawl: true })).toContain('-js-crawl')
    const { targets } = emitFor('katana', 'katana-sample.jsonl', 'url', 'https://example.com')
    expect(targets.map((t) => t.value)).toEqual([
      'https://example.com/', 'https://example.com/about',
    ])
    expect(targets.every((t) => t.kind === 'url')).toBe(true)
  })
})

describe('sslscan', () => {
  it('adds --no-fallback when set and parses cipher rows', () => {
    expect(argvFor('sslscan', 'example.com', {})).toEqual(['--xml=-', 'example.com'])
    expect(argvFor('sslscan', 'example.com', { no_fallback: true })).toEqual([
      '--xml=-', '--no-fallback', 'example.com',
    ])
    const { facts } = emitFor('sslscan', 'sslscan-sample.xml', 'domain', 'example.com')
    expect(facts.map((f) => ({ cipher: f.data.cipher, bits: f.data.bits }))).toEqual([
      { cipher: 'ECDHE-RSA-AES256-GCM-SHA384', bits: '256' },
      { cipher: 'ECDHE-RSA-AES128-GCM-SHA256', bits: '128' },
    ])
    expect(facts.every((f) => f.kind === 'raw_output')).toBe(true)
  })
})
