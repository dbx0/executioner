import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runGoldenCase, runGoldenCaseWithEmit, type GoldenCase } from './golden.js'
import { bundledManifestsDir } from './registry.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')

describe('ported batch 2: mtr, nikto, searchsploit, testssl', () => {
  it('parses mtr JSON hubs into hop records', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'mtr.toml'),
      fixtureFile: join(fixturesDir, 'mtr-sample.json'),
      expectedRecords: [
        { count: 1, host: '192.168.1.1', 'Loss%': 0.0, Snt: 10, Last: 0.5, Avg: 0.6, Best: 0.4, Wrst: 0.9, StDev: 0.1 },
        { count: 2, host: '10.0.0.1', 'Loss%': 0.0, Snt: 10, Last: 5.2, Avg: 5.4, Best: 5.0, Wrst: 6.1, StDev: 0.3 },
      ],
    }

    const result = runGoldenCase(goldenCase)

    expect(result.records).toEqual(goldenCase.expectedRecords)
  })

  it('parses nikto JSON vulnerabilities into finding records', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'nikto.toml'),
      fixtureFile: join(fixturesDir, 'nikto-sample.json'),
      expectedRecords: [
        { id: '999100', method: 'GET', url: '/', msg: 'Retrieved x-powered-by header: PHP/7.4.3' },
        { id: '999200', method: 'GET', url: '/admin/', msg: 'Admin login page found' },
      ],
    }

    const result = runGoldenCase(goldenCase)

    expect(result.records).toEqual(goldenCase.expectedRecords)
  })

  it('parses searchsploit JSON RESULTS_EXPLOIT into exploit records', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'searchsploit.toml'),
      fixtureFile: join(fixturesDir, 'searchsploit-sample.json'),
      expectedRecords: [
        {
          Title: 'Apache 2.4.49 - Path Traversal',
          'EDB-ID': '50383',
          Date: '2021-10-06',
          Type: 'webapps',
          Platform: 'multiple',
          Path: 'exploits/multiple/webapps/50383.py',
        },
      ],
    }

    const result = runGoldenCase(goldenCase)

    expect(result.records).toEqual(goldenCase.expectedRecords)
  })

  it('parses testssl JSON array into finding records', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'testssl.toml'),
      fixtureFile: join(fixturesDir, 'testssl-sample.json'),
      expectedRecords: [
        { id: 'TLS1_3', severity: 'OK', finding: 'offered' },
        { id: 'TLS1', severity: 'MEDIUM', finding: 'offered' },
      ],
    }

    const result = runGoldenCase(goldenCase)

    expect(result.records).toEqual(goldenCase.expectedRecords)
    expect(result.records).toContainEqual({ id: 'TLS1_3', severity: 'OK', finding: 'offered' })
  })
})

describe('nuclei reads its findings from stdout', () => {
  it('parses JSONL output into one vulnerability fact per finding', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'nuclei.toml'),
      fixtureFile: join(fixturesDir, 'nuclei-sample.jsonl'),
      expectedRecords: [],
    }
    const ctx = {
      target: { id: 'target-1', kind: 'url' as const, value: 'https://example.com' },
      params: {},
      nodeId: 'nuclei',
      executionId: 'exec-1',
    }
    const result = runGoldenCaseWithEmit(goldenCase, ctx)
    expect(result.records.map((r) => r['template-id'])).toEqual(['tech-detect', 'CVE-2021-44228'])
    expect(result.facts.map((f) => f.data)).toEqual([
      { template: 'tech-detect', severity: 'info' },
      { template: 'CVE-2021-44228', severity: 'critical' },
    ])
  })
})
