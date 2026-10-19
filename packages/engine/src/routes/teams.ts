import { Hono } from 'hono'
import { BUILTIN_TEAMS, getTeam, summariseTeam } from '../agents/agent-team.js'

/**
 * Read-only catalogue of the built-in Claude Agent Teams. The desktop spawn menu
 * lists these and the team panel renders a team's roster + per-member metadata.
 * Prompts are intentionally omitted from the summary (see summariseTeam); the
 * full roster is only ever serialised into `claude --agents` at launch time.
 *
 * Mounted under the bearer-guarded /api router.
 */
export function teamRoutes(): Hono {
  const app = new Hono()

  app.get('/teams', (c) => c.json(BUILTIN_TEAMS.map(summariseTeam)))

  app.get('/teams/:id', (c) => {
    const team = getTeam(c.req.param('id'))
    if (team === undefined) return c.json({ error: 'not found' }, 404)
    return c.json(summariseTeam(team))
  })

  return app
}
