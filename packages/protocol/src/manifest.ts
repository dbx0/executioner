import { z } from 'zod'
import { targetKindSchema } from './target.js'
import { targetFactKindSchema } from './target.js'

/** UI/metadata hints shared by every param type (all optional, back-compat). */
const paramMeta = {
  /** Human label; falls back to the param name in the UI. */
  label: z.string().optional(),
  /** Help text shown under the control. */
  description: z.string().optional(),
  /** Marks the field required in the UI (does not gate execution). */
  required: z.boolean().optional(),
  /** A caution banner rendered above the control (e.g. destructive sqlmap flags). */
  warning: z.string().optional(),
  /** Example text shown inside an empty field. */
  placeholder: z.string().optional(),
}

/** A declared, typed input to a node, referenced as {{ params.<name> }}. */
export const paramSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('string'),
    default: z.string().optional(),
    /** Control style for a string field: single-line, multi-line, or code. */
    ui: z.enum(['text', 'textarea', 'code']).optional(),
    ...paramMeta,
  }),
  z.object({ type: z.literal('number'), default: z.number().optional(), ...paramMeta }),
  z.object({ type: z.literal('bool'), default: z.boolean().optional(), ...paramMeta }),
  z.object({
    type: z.literal('enum'),
    values: z.array(z.string()).min(1),
    default: z.string().optional(),
    ...paramMeta,
  }),
])

export type ParamSpec = z.infer<typeof paramSpecSchema>

export const emitTargetRuleSchema = z.object({
  kind: targetKindSchema,
  value: z.string().min(1),
  parent: z.enum(['input', 'none']).default('none'),
})

export const emitFactRuleSchema = z.object({
  kind: targetFactKindSchema,
  data: z.record(z.string(), z.string()),
})

export const emitSchema = z
  .object({
    parser: z.enum(['json', 'regex', 'file', 'whois']),
    source: z.enum(['stdout', 'stderr']).default('stdout'),
    records: z.string().default('$'),
    pattern: z.string().optional(),
    path: z.string().optional(),
    format: z.enum(['json', 'jsonl']).optional(),
    targets: z.array(emitTargetRuleSchema).default([]),
    facts: z.array(emitFactRuleSchema).default([]),
  })
  .superRefine((emit, ctx) => {
    if (emit.parser === 'regex' && emit.pattern === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'regex parser requires a pattern' })
    }
    if (emit.parser === 'file' && (emit.path === undefined || emit.format === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'file parser requires path and format' })
    }
  })

export type EmitSpec = z.infer<typeof emitSchema>

export const commandSchema = z.object({
  program: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeout_ms: z.number().int().positive().default(120000),
})

export const toolManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  accepts: z.array(targetKindSchema).min(1),
  params: z.record(z.string(), paramSpecSchema).default({}),
  command: commandSchema,
  emit: emitSchema,
})

export type ToolManifest = z.infer<typeof toolManifestSchema>
