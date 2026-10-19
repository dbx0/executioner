import type { Project } from '@exe/project'
import type { NodeRegistry } from '@exe/nodes'
import type { ToolManifest } from '@exe/protocol'

/**
 * The full tool surface for a project: the bundled registry manifests merged
 * with the user-authored custom nodes, which are user-level (they travel with
 * the workflows that name them). Built
 * fresh at the point of consumption (GET /nodes, the executor) so newly created
 * custom nodes take effect without a restart.
 *
 * Collision policy: a custom node may not reuse a bundled id (the routes reject
 * that on create/update). If one somehow exists, the custom definition wins.
 */
export function buildManifestMap(registry: NodeRegistry, project: Project): Map<string, ToolManifest> {
  const map = new Map<string, ToolManifest>(registry.list().map((m) => [m.id, m]))
  for (const custom of project.customNodes.list()) {
    map.set(custom.id, custom)
  }
  return map
}
