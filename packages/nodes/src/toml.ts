import { parse as parseToml } from 'smol-toml'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'

/** Parse TOML text into a validated ToolManifest. Throws on syntax or schema errors. */
export function loadManifestFromToml(text: string): ToolManifest {
  return toolManifestSchema.parse(parseToml(text))
}
