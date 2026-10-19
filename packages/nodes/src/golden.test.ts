import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runGoldenCase, type GoldenCase } from './golden.js'
import { bundledManifestsDir } from './registry.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')

describe('runGoldenCase', () => {
  it('parses a fixture through a real manifest and returns matching records', () => {
    const goldenCase: GoldenCase = {
      manifestFile: join(bundledManifestsDir(), 'nmap.toml'),
      fixtureFile: join(fixturesDir, 'nmap-sample.txt'),
      expectedRecords: [
        { port: '22', service: 'ssh' },
        { port: '80', service: 'http' },
      ],
    }

    const result = runGoldenCase(goldenCase)

    expect(result.records).toEqual(goldenCase.expectedRecords)
  })
})
