import { readFileSync } from 'node:fs'
import type { EmitSpec } from '@exe/protocol'
import { loadManifestFromToml } from './toml.js'
import { extractRecords, type ParseSpec } from './parsers.js'
import { applyEmit, type EmitContext, type EmitResult } from './emit.js'

/** Build a ParseSpec from a manifest's emit spec, dropping unset optional fields. */
function toParseSpec(emit: EmitSpec): ParseSpec {
  const spec: ParseSpec = { parser: emit.parser, records: emit.records }
  if (emit.pattern !== undefined) spec.pattern = emit.pattern
  if (emit.format !== undefined) spec.format = emit.format
  return spec
}

/** One golden case: a manifest file, a captured output fixture, and the records it must produce. */
export interface GoldenCase {
  manifestFile: string
  fixtureFile: string
  expectedRecords: Record<string, unknown>[]
}

export interface GoldenRunResult {
  records: Record<string, unknown>[]
}

/**
 * Runs a golden case end to end: load the manifest, read the fixture, and extract
 * records through the manifest's emit spec. Callers compare `records` against
 * `expectedRecords` themselves.
 */
export function runGoldenCase(goldenCase: GoldenCase): GoldenRunResult {
  const manifestText = readFileSync(goldenCase.manifestFile, 'utf8')
  const manifest = loadManifestFromToml(manifestText)
  const fixtureText = readFileSync(goldenCase.fixtureFile, 'utf8')
  const records = extractRecords(toParseSpec(manifest.emit), fixtureText)
  return { records }
}

/**
 * Like `runGoldenCase`, but also applies the manifest's emit rules to produce
 * targets and facts, for golden cases that want to pin those too.
 */
export function runGoldenCaseWithEmit(
  goldenCase: GoldenCase,
  ctx: EmitContext,
): GoldenRunResult & EmitResult {
  const { records } = runGoldenCase(goldenCase)
  const manifestText = readFileSync(goldenCase.manifestFile, 'utf8')
  const manifest = loadManifestFromToml(manifestText)
  const { targets, facts } = applyEmit(records, manifest.emit, ctx)
  return { records, targets, facts }
}
