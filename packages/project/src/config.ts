import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { layout } from './layout.js'

export const projectConfigSchema = z.object({
  name: z.string().min(1),
  /** An optional emoji icon shown for the engagement (rail, tabs). */
  icon: z.string().optional(),
  defaultBackend: z.enum(['local', 'docker', 'ssh']).default('local'),
  createdAt: z.string().datetime(),
})

export type ProjectConfig = z.infer<typeof projectConfigSchema>

export function readConfig(root: string): ProjectConfig {
  const path = layout.config(root)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(`${path} could not be read as JSON: config.json is invalid`, { cause })
  }
  const result = projectConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${path} config.json is invalid: ${result.error.message}`)
  }
  return result.data
}

export function writeConfig(root: string, config: ProjectConfig): void {
  writeFileSync(layout.config(root), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
