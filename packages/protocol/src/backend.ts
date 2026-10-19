import { z } from 'zod'

/** Where a node's command actually runs. */
export const backendKindSchema = z.enum(['local', 'ssh', 'docker'])
export type BackendKind = z.infer<typeof backendKindSchema>

/**
 * The editable fields of a backend profile. `host`/`port`/`user`/`identityFile`
 * describe an SSH target; `image` names a Docker image; `workdir` is the remote
 * working directory (SSH) or the container workdir (Docker). Kind-specific
 * requirements are enforced by the refinement below.
 */
const profileFields = z.object({
  name: z.string().min(1),
  kind: backendKindSchema,
  host: z.string().optional(),
  port: z.number().int().positive().max(65535).optional(),
  user: z.string().optional(),
  identityFile: z.string().optional(),
  image: z.string().optional(),
  workdir: z.string().optional(),
  /** Extra environment for the command (e.g. PATH to reach ~/go/bin over SSH). */
  env: z.record(z.string(), z.string()).optional(),
})

function refineKind(p: z.infer<typeof profileFields>, ctx: z.RefinementCtx): void {
  if (p.kind === 'ssh' && (p.host === undefined || p.host === '' || p.user === undefined || p.user === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ssh backend requires host and user' })
  }
  if (p.kind === 'docker' && (p.image === undefined || p.image === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'docker backend requires image' })
  }
}

/** A POSIX environment variable name: what `export NAME=...` and `docker -e` accept. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Why a value cannot be handed to ssh or docker as a destination or image, or
 * null when it can. A leading '-' would be parsed as an option
 * (`-oProxyCommand=...` runs a local command), and whitespace or control
 * characters have no place in a host, a user or an image reference.
 */
export function launchValueProblem(value: string): string | null {
  if (value.startsWith('-')) return 'must not start with "-"'
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(value)) return 'must not contain spaces or control characters'
  return null
}

/** The checks a profile must pass before it is saved and later launched. */
function refineSafety(p: z.infer<typeof profileFields>, ctx: z.RefinementCtx): void {
  for (const field of ['host', 'user', 'image'] as const) {
    const value = p[field]
    if (value === undefined || value === '') continue
    const problem = launchValueProblem(value)
    if (problem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} ${problem}` })
  }
  for (const name of Object.keys(p.env ?? {})) {
    if (!ENV_NAME.test(name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['env', name], message: `"${name}" is not a valid variable name` })
    }
  }
}

/**
 * What a client sends to create or update a profile (server assigns
 * id/timestamps). Stricter than a stored profile: a row saved by an older build
 * still reads back, and the launcher refuses it at run time instead.
 */
export const backendProfileInputSchema = profileFields.superRefine((p, ctx) => {
  refineKind(p, ctx)
  refineSafety(p, ctx)
})
export type BackendProfileInput = z.infer<typeof backendProfileInputSchema>

/** A stored backend profile. */
export const backendProfileSchema = profileFields
  .extend({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine(refineKind)
export type BackendProfile = z.infer<typeof backendProfileSchema>
