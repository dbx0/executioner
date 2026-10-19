import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runGoldenCase, type GoldenCase } from './golden.js'
import { bundledManifestsDir, loadManifests } from './registry.js'
import { loadManifestFromToml } from './toml.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')
const manifestsDir = bundledManifestsDir()

const NODE_IDS = ['dalfox', 'sqlmap', 'wpscan', 'hydra', 'netexec']

describe('batch 3 manifests load and validate', () => {
  for (const id of NODE_IDS) {
    it(`${id} loads as a valid manifest`, () => {
      const manifest = loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8'))
      expect(manifest.id).toBe(id)
      expect(manifest.command.program.length).toBeGreaterThan(0)
    })
  }

  it('loadManifests picks up all batch-3 manifests without a duplicate-id error', () => {
    const manifests = loadManifests(manifestsDir)
    for (const id of NODE_IDS) {
      expect(manifests.has(id)).toBe(true)
    }
  })
})

describe('dalfox parses JSON XSS findings', () => {
  it('extracts type, param, payload, evidence, severity', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'dalfox.toml'),
      fixtureFile: join(fixturesDir, 'dalfox-sample.json'),
      expectedRecords: [
        {
          type: 'reflected',
          param: 'q',
          payload: '<script>alert(1)</script>',
          evidence: '<input value="<script>alert(1)</script>">',
          severity: 'High',
        },
        {
          type: 'reflected',
          param: 'name',
          payload: '"><img src=x onerror=alert(1)>',
          evidence: '<div>"><img src=x onerror=alert(1)></div>',
          severity: 'Medium',
        },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('sqlmap parses injectable parameter blocks', () => {
  it('extracts param, type, payload from a Parameter block', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'sqlmap.toml'),
      fixtureFile: join(fixturesDir, 'sqlmap-sample.txt'),
      expectedRecords: [{ param: 'id', type: 'boolean-based blind', payload: 'id=1 AND 5678=5678' }],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('wpscan parses the top-level JSON report object', () => {
  it('extracts target_url, effective_url, version, plugins', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'wpscan.toml'),
      fixtureFile: join(fixturesDir, 'wpscan-sample.json'),
      expectedRecords: [
        {
          target_url: 'http://example.com/',
          effective_url: 'http://example.com/',
          version: '5.7',
          plugins: {
            akismet: {
              slug: 'akismet',
              version: '4.1.9',
            },
          },
        },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('hydra parses cracked credential lines', () => {
  it('extracts port, service, host, login, password', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'hydra.toml'),
      fixtureFile: join(fixturesDir, 'hydra-sample.txt'),
      expectedRecords: [
        { port: '22', service: 'ssh', host: '10.0.0.5', login: 'admin', password: 'admin123' },
        { port: '22', service: 'ssh', host: '10.0.0.5', login: 'root', password: 'toor' },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})

describe('netexec parses info lines', () => {
  it('extracts protocol, ip, port, hostname, info', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(manifestsDir, 'netexec.toml'),
      fixtureFile: join(fixturesDir, 'netexec-sample.txt'),
      expectedRecords: [
        {
          protocol: 'SMB',
          ip: '10.0.0.5',
          port: '445',
          hostname: 'DC01',
          info: 'Windows Server 2019 Build 17763 x64 (name:DC01) (domain:CORP) (signing:True) (SMBv1:False)',
        },
      ],
    }
    const result = runGoldenCase(goldenCase)
    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})
