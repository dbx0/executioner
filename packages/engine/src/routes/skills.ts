import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import {
  discoverSkills,
  generateAgentsMd,
  normalizeSkillsConfig,
  readSkillsConfig,
  writeSkillsConfig,
} from '../infra/skills.js'

/**
 * The shape PUT /skills/config accepts. The folder is the operator's own pick
 * (trusted), so only its type is checked; normalisation does the rest.
 */
const skillsConfigSchema = z
  .object({
    folder: z.string().nullable().optional(),
    enabled: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

/**
 * Agent Skills routes (bearer-guarded under /api). The config is user-level
 * (`~/.executioner/skills.json`), so the folder and toggles follow the user
 * into every engagement; `AGENTS.md` is still written into this engagement.
 *   GET  /skills/config   → the parsed skills.json (defaults folder:null enabled:{}).
 *   PUT  /skills/config   → validate + persist skills.json.
 *   GET  /skills[?folder] → discover + parse skills in the configured (or override) folder.
 *   POST /skills/agents-md → (re)generate <root>/AGENTS.md from the discovered skills.
 */
export function skillRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/skills/config', (c) => c.json(readSkillsConfig(project.root)))

  app.put('/skills/config', async (c) => {
    const parsed = skillsConfigSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid config' }, 400)
    const saved = writeSkillsConfig(normalizeSkillsConfig(parsed.data))
    return c.json(saved)
  })

  app.get('/skills', (c) => {
    const override = c.req.query('folder')
    const folder = override !== undefined && override !== '' ? override : readSkillsConfig(project.root).folder
    return c.json(discoverSkills(folder))
  })

  app.post('/skills/agents-md', (c) => {
    const folder = readSkillsConfig(project.root).folder
    const skills = discoverSkills(folder)
    return c.json(generateAgentsMd(project.root, skills))
  })

  return app
}
