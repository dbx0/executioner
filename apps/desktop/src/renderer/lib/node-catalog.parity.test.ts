/**
 * Characterisation tests pinning the two parallel node catalogues together.
 *
 * The same 18 built-in node types are currently declared TWICE: once in
 * `apps/desktop/src/renderer/lib/node-catalog.ts` as `CONTROL_ENTRIES` (which
 * drives the workflow palette) and once in
 * `packages/engine/src/mcp/node-types.ts` as `BUILTIN_NODE_TYPES` (which drives
 * the MCP toolset the workflow assistant sees). Nothing enforced that they
 * agree, and they had already drifted.
 *
 * These tests are the safety net for collapsing that duplication into a single
 * source of truth. They assert the OBSERVABLE agreement between the two sides,
 * so a later unification can be proven not to change what either the palette or
 * the assistant sees.
 *
 * The one deliberate asymmetry is param `type`: the engine declares enums as
 * `type: 'enum'` with `oneOf`, while the desktop catalogue stores the
 * post-normalisation form `type: 'string'` with the same `oneOf`. That is not
 * drift; `toParamSpecs` performs exactly that mapping, and `ParamDrawer` renders
 * a select whenever `oneOf` is present. The tests below encode that mapping
 * rather than pretending the two literals match.
 */
import { describe, expect, it } from 'vitest'
// Imported from SOURCE, not dist: packages/*/dist is untracked, so a dist-based
// import would make this test (and the desktop typecheck) fail on a fresh clone.
import { BUILTIN_NODE_TYPES } from '../../../../../packages/engine/src/mcp/node-types.js'
import { CONTROL_ENTRIES } from './node-catalog.js'
import { graphNodeTypes } from '../components/canvas/GraphNodes.js'

const desktopByType = new Map(CONTROL_ENTRIES.map((e) => [e.type, e]))
const engineByType = new Map(BUILTIN_NODE_TYPES.map((e) => [e.type, e]))

/** The engine stores enums pre-normalisation; the palette stores them after. */
function normaliseEngineParamType(type: string): string {
  return type === 'enum' ? 'string' : type === 'bool' ? 'boolean' : type
}

describe('node catalogue parity', () => {
  it('both catalogues declare exactly the same node types', () => {
    expect([...desktopByType.keys()].sort()).toEqual([...engineByType.keys()].sort())
  })

  it('declares 18 built-in node types', () => {
    expect(desktopByType.size).toBe(18)
    expect(engineByType.size).toBe(18)
  })

  for (const type of [...new Set([...desktopByType.keys()])].sort()) {
    describe(`node "${type}"`, () => {
      it('agrees on label, kind and category', () => {
        const d = desktopByType.get(type)
        const e = engineByType.get(type)
        expect(d).toBeDefined()
        expect(e).toBeDefined()
        expect(d!.label).toBe(e!.label)
        expect(d!.kind).toBe(e!.kind)
        expect(d!.category).toBe(e!.category)
      })

      it('agrees on the parameter list and its order', () => {
        const d = desktopByType.get(type)!
        const e = engineByType.get(type)!
        expect(d.params.map((p) => p.name)).toEqual(e.params.map((p) => p.name))
      })

      it('agrees on each parameter type, default and allowed values', () => {
        const d = desktopByType.get(type)!
        const e = engineByType.get(type)!
        for (const [i, ep] of e.params.entries()) {
          const dp = d.params[i]
          expect(dp).toBeDefined()
          expect(dp!.type).toBe(normaliseEngineParamType(ep.type))
          expect(dp!.default).toEqual(ep.default)
          expect(dp!.oneOf).toEqual(ep.oneOf)
        }
      })

      it('agrees on declared outputs', () => {
        const d = desktopByType.get(type)!
        const e = engineByType.get(type)!
        expect(d.outputs ?? []).toEqual(e.outputs ?? [])
      })
    })
  }

  /**
   * The third place a node type has to be declared: the canvas needs a
   * component for it, or ReactFlow silently falls back to an unstyled default
   * box — which is exactly what happened to `save_to_finding`.
   */
  it('every catalogue node type has a canvas component', () => {
    const missing = CONTROL_ENTRIES.map((e) => e.type).filter((type) => !(type in graphNodeTypes))
    expect(missing).toEqual([])
  })
})
