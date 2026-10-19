import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runGoldenCase, runGoldenCaseWithEmit, type GoldenCase } from './golden.js'
import { bundledManifestsDir, loadManifests } from './registry.js'
import { loadManifestFromToml } from './toml.js'
import { readFileSync } from 'node:fs'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')
const manifestsDir = bundledManifestsDir()

const NODE_IDS = [
  'masscan',
  'rustscan',
  'traceroute',
  'nbtscan',
  'enum4linux',
  'gau',
  'feroxbuster',
  'theharvester',
]

const ctx = {
  target: { id: 'target-1', kind: 'domain' as const, value: 'example.com' },
  params: {},
  nodeId: 'ported-node',
  executionId: 'exec-1',
}

describe('batch 1 manifests load and validate', () => {
  for (const id of NODE_IDS) {
    it(`${id} loads as a valid manifest`, () => {
      const manifest = loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8'))
      expect(manifest.id).toBe(id)
      expect(manifest.command.program.length).toBeGreaterThan(0)
    })
  }

  it('loadManifests picks up all batch-1 manifests without a duplicate-id error', () => {
    const manifests = loadManifests(manifestsDir)
    for (const id of NODE_IDS) {
      expect(manifests.has(id)).toBe(true)
    }
  })
})

describe('masscan parses discovered open ports', () => {
  it('extracts port, protocol, host from masscan text output', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'masscan.toml'),
      fixtureFile: join(fixturesDir, 'masscan-sample.txt'),
      expectedRecords: [
        { port: '80', protocol: 'tcp', host: '192.168.1.1' },
        { port: '443', protocol: 'tcp', host: '192.168.1.1' },
        { port: '53', protocol: 'udp', host: '192.168.1.2' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('rustscan parses open host:port lines', () => {
  it('extracts host and port', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'rustscan.toml'),
      fixtureFile: join(fixturesDir, 'rustscan-sample.txt'),
      expectedRecords: [
        { host: '192.168.1.1', port: '22' },
        { host: '192.168.1.1', port: '80' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('traceroute parses numbered hop lines', () => {
  it('extracts hop, host, ip, rtt', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'traceroute.toml'),
      fixtureFile: join(fixturesDir, 'traceroute-sample.txt'),
      expectedRecords: [
        { hop: '1', host: 'gateway', ip: '192.168.1.1', rtt: '1.234' },
        { hop: '2', host: '10.0.0.1', ip: '10.0.0.1', rtt: '5.678' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('nbtscan parses NetBIOS table rows', () => {
  it('extracts ip and netbios_name', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'nbtscan.toml'),
      fixtureFile: join(fixturesDir, 'nbtscan-sample.txt'),
      expectedRecords: [
        { ip: '192.168.1.10', netbios_name: 'MYHOST' },
        { ip: '192.168.1.20', netbios_name: 'OTHERHOST' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('enum4linux parses SMB share rows', () => {
  it('extracts share, type, comment', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'enum4linux.toml'),
      fixtureFile: join(fixturesDir, 'enum4linux-sample.txt'),
      expectedRecords: [
        { share: 'print$', type: 'Disk', comment: 'Printer Drivers' },
        { share: 'tmp', type: 'Disk', comment: 'IPC Service' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('gau parses jsonl urls', () => {
  it('extracts the url field', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'gau.toml'),
      fixtureFile: join(fixturesDir, 'gau-sample.jsonl'),
      expectedRecords: [{ url: 'http://example.com/a' }, { url: 'http://example.com/b' }],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })

  it('emits discovered urls as url targets linked to the input', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'gau.toml'),
      fixtureFile: join(fixturesDir, 'gau-sample.jsonl'),
      expectedRecords: [{ url: 'http://example.com/a' }, { url: 'http://example.com/b' }],
    }
    const result = runGoldenCaseWithEmit(goldenCase, ctx)
    expect(result.targets).toEqual([
      { kind: 'url', value: 'http://example.com/a', source: 'ported-node', parentId: 'target-1' },
      { kind: 'url', value: 'http://example.com/b', source: 'ported-node', parentId: 'target-1' },
    ])
  })
})

describe('feroxbuster parses jsonl response records', () => {
  it('extracts url, status and other response fields', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'feroxbuster.toml'),
      fixtureFile: join(fixturesDir, 'feroxbuster-sample.jsonl'),
      expectedRecords: [
        {
          type: 'response',
          url: 'http://example.com/admin',
          status: 200,
          content_length: 1234,
          word_count: 10,
          line_count: 5,
          method: 'GET',
        },
        {
          type: 'response',
          url: 'http://example.com/login',
          status: 301,
          content_length: 0,
          word_count: 0,
          line_count: 0,
          method: 'GET',
        },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('theharvester parses discovered host:ip lines', () => {
  it('extracts host and ip', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'theharvester.toml'),
      fixtureFile: join(fixturesDir, 'theharvester-sample.txt'),
      expectedRecords: [
        { host: 'www.example.com', ip: '93.184.216.34' },
        { host: 'mail.example.com', ip: '93.184.216.10' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })

  it('emits discovered hosts as subdomain targets linked to the input', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'theharvester.toml'),
      fixtureFile: join(fixturesDir, 'theharvester-sample.txt'),
      expectedRecords: [
        { host: 'www.example.com', ip: '93.184.216.34' },
        { host: 'mail.example.com', ip: '93.184.216.10' },
      ],
    }
    const result = runGoldenCaseWithEmit(goldenCase, ctx)
    expect(result.targets.every((t) => t.kind === 'subdomain')).toBe(true)
    expect(result.targets).toEqual([
      { kind: 'subdomain', value: 'www.example.com', source: 'ported-node', parentId: 'target-1' },
      { kind: 'subdomain', value: 'mail.example.com', source: 'ported-node', parentId: 'target-1' },
    ])
  })
})
