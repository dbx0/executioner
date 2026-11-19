import { describe, expect, it } from 'vitest'
import { STARTER_WORKFLOWS } from '@exe/db'
import { graphSchema } from '@exe/graph'
import { bundledManifestsDir, loadManifests } from '@exe/nodes'
import { buildNodeTypes } from '../mcp/node-types.js'

/** Keys every node accepts besides its declared params. */
const NODE_SETTINGS = new Set(['target', '__no_save', '__on_failure', '__timeout_ms'])

const nodeTypes = new Map(buildNodeTypes([...loadManifests(bundledManifestsDir()).values()]).map((t) => [t.type, t]))

describe('starter workflows against the real node catalog', () => {
  for (const starter of STARTER_WORKFLOWS) {
    it(`${starter.name}: every node is a node that exists, set only through params it has`, () => {
      const graph = graphSchema.parse(starter.graph)
      for (const node of graph.nodes) {
        const type = nodeTypes.get(node.type)
        expect(type, `${node.id}: unknown node type "${node.type}"`).toBeDefined()
        const params = new Set((type?.params ?? []).map((p) => p.name))
        for (const key of Object.keys(node.data)) {
          expect(params.has(key) || NODE_SETTINGS.has(key), `${node.id}: "${key}" is not a param of ${node.type}`).toBe(true)
        }
      }
    })
  }
})
