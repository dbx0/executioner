import { Hono } from 'hono'
import { z } from 'zod'
import { globalLayout } from '@exe/protocol'
import type { Project } from '@exe/project'
import { backendProfileInputSchema } from '@exe/protocol'
import { testBackend } from '../infra/backend-test.js'
import { enrollSshKey } from '../infra/ssh-enroll.js'

/** What a key enrolment takes. The password is used once and never stored. */
const enrollSchema = z.object({
  host: z.string().trim().min(1),
  user: z.string().trim().min(1),
  password: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
})

/**
 * CRUD for the user's saved backend profiles. These are USER-level (they live in
 * `~/.executioner/global.sqlite` behind `project.backends`), so a connection
 * saved in one engagement is there in the next. Mounted under the bearer-guarded
 * /api router.
 */
export function backendRoutes(project: Project, enroll: typeof enrollSshKey = enrollSshKey): Hono {
  const app = new Hono()

  app.get('/backends', (c) => c.json(project.backends.list()))

  // Enroll a generated SSH key on a password host: generate a keypair, install
  // its public key using the password (once), verify key-auth works, and return
  // the identity file to save. The password is transient — never stored or logged.
  app.post('/backends/ssh-enroll', async (c) => {
    const parsed = enrollSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'host, user and password are required' }, 400)
    const { host, user, password, port } = parsed.data
    // The key belongs with the connection: user-level, so the profile keeps
    // working from every engagement and outlives the one it was made in.
    const keyDir = globalLayout.sshKeys()
    const result = await enroll({ host, user, password, keyDir, ...(port !== undefined ? { port } : {}) })
    return c.json(result)
  })

  // Liveness test for a profile *before* saving it: ssh connects & runs a
  // command; docker pulls the image and runs a throwaway container. Every step
  // has a hard timeout so this never hangs the engine.
  app.post('/backends/test', async (c) => {
    const parsed = backendProfileInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid backend profile', detail: parsed.error.format() }, 400)
    // `?createWorkdir=1` mkdir -p a missing ssh workdir before verifying it.
    const createWorkdir = c.req.query('createWorkdir') === '1'
    return c.json(await testBackend(parsed.data, undefined, { createWorkdir }))
  })

  app.post('/backends', async (c) => {
    const parsed = backendProfileInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid backend profile', detail: parsed.error.format() }, 400)
    return c.json(project.backends.create(parsed.data), 201)
  })

  app.put('/backends/:id', async (c) => {
    const parsed = backendProfileInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid backend profile', detail: parsed.error.format() }, 400)
    const updated = project.backends.update(c.req.param('id'), parsed.data)
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    return c.json(updated)
  })

  app.delete('/backends/:id', (c) => {
    project.backends.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  return app
}
