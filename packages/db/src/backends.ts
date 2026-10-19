import { asc, eq } from 'drizzle-orm'
import { isoNow, newId, backendProfileSchema, type BackendProfile, type BackendProfileInput } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { backendProfiles } from './tables.js'

type Row = typeof backendProfiles.$inferSelect

/** The kind-specific fields we serialize into the `config` JSON column. */
type Config = Pick<BackendProfile, 'host' | 'port' | 'user' | 'identityFile' | 'image' | 'workdir' | 'env'>

function pickConfig(input: BackendProfileInput | BackendProfile): Config {
  const c: Config = {}
  if (input.host !== undefined) c.host = input.host
  if (input.port !== undefined) c.port = input.port
  if (input.user !== undefined) c.user = input.user
  if (input.identityFile !== undefined) c.identityFile = input.identityFile
  if (input.image !== undefined) c.image = input.image
  if (input.workdir !== undefined) c.workdir = input.workdir
  if (input.env !== undefined) c.env = input.env
  return c
}

function toProfile(r: Row): BackendProfile {
  // The schema parse below validates whatever the config column held, so a
  // hand-edited row fails loudly here instead of reaching a launcher.
  const config = JSON.parse(r.config) as Config
  return backendProfileSchema.parse({
    id: r.id,
    name: r.name,
    kind: r.kind,
    ...config,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })
}

/** CRUD for the user's saved backend profiles (local/ssh/docker). */
export class BackendProfileRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  list(): BackendProfile[] {
    return this.orm.select().from(backendProfiles).orderBy(asc(backendProfiles.createdAt)).all().map(toProfile)
  }

  get(id: string): BackendProfile | undefined {
    const row = this.orm.select().from(backendProfiles).where(eq(backendProfiles.id, id)).get()
    return row === undefined ? undefined : toProfile(row)
  }

  create(input: BackendProfileInput): BackendProfile {
    const now = isoNow()
    const profile = backendProfileSchema.parse({ id: newId(), ...input, createdAt: now, updatedAt: now })
    this.orm
      .insert(backendProfiles)
      .values({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        config: JSON.stringify(pickConfig(profile)),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })
      .run()
    return profile
  }

  update(id: string, input: BackendProfileInput): BackendProfile | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    const profile = backendProfileSchema.parse({
      id,
      ...input,
      createdAt: existing.createdAt,
      updatedAt: isoNow(),
    })
    this.orm
      .update(backendProfiles)
      .set({
        name: profile.name,
        kind: profile.kind,
        config: JSON.stringify(pickConfig(profile)),
        updatedAt: profile.updatedAt,
      })
      .where(eq(backendProfiles.id, id))
      .run()
    return profile
  }

  remove(id: string): void {
    this.orm.delete(backendProfiles).where(eq(backendProfiles.id, id)).run()
  }
}
