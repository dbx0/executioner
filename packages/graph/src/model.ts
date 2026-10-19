import { z } from 'zod'

export const graphNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough() // tolerate React Flow's position/width/etc without copying them

export type GraphNode = z.infer<typeof graphNodeSchema>

export const graphEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().default(null),
  })
  .passthrough()

export type GraphEdge = z.infer<typeof graphEdgeSchema>

export const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
})

export type Graph = z.infer<typeof graphSchema>
