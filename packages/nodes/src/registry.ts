import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ToolManifest } from '@exe/protocol'
import { loadManifestFromToml } from './toml.js'

/** Absolute path to the bundled manifests directory, resolved from this module. */
export function bundledManifestsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'manifests')
}

/** Load every *.toml in a directory into a map keyed by manifest id. Throws on a duplicate id. */
export function loadManifests(dir: string): Map<string, ToolManifest> {
  const map = new Map<string, ToolManifest>()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.toml')) continue
    const manifest = loadManifestFromToml(readFileSync(join(dir, entry), 'utf8'))
    if (map.has(manifest.id)) {
      throw new Error(`duplicate manifest id "${manifest.id}" in ${entry}`)
    }
    map.set(manifest.id, manifest)
  }
  return map
}

/** Read-only view over the loaded manifests. */
export class NodeRegistry {
  constructor(private readonly manifests: Map<string, ToolManifest>) {}

  get(id: string): ToolManifest | undefined {
    return this.manifests.get(id)
  }

  list(): ToolManifest[] {
    return [...this.manifests.values()]
  }
}
