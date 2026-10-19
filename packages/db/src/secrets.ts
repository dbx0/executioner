import { asc, eq } from 'drizzle-orm'
import { isoNow } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { secrets } from './tables.js'

export interface Secret {
  key: string
  value: string
  updatedAt: string
}

/**
 * Key/value store for API credentials (Shodan, Censys, …). This is a local tool
 * the user controls; values are stored in plaintext and node params reference
 * them as {{ secrets.NAME }}. The project wires this against the USER-level
 * database, so one key serves every engagement.
 */
export class SecretRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  list(): Secret[] {
    return this.orm.select().from(secrets).orderBy(asc(secrets.key)).all()
  }

  get(key: string): Secret | undefined {
    return this.orm.select().from(secrets).where(eq(secrets.key, key)).get()
  }

  /** Insert or replace a secret, returning the stored record. */
  set(key: string, value: string): Secret {
    const secret: Secret = { key, value, updatedAt: isoNow() }
    this.orm
      .insert(secrets)
      .values(secret)
      .onConflictDoUpdate({ target: secrets.key, set: { value: secret.value, updatedAt: secret.updatedAt } })
      .run()
    return secret
  }

  remove(key: string): void {
    this.orm.delete(secrets).where(eq(secrets.key, key)).run()
  }

  /** All secrets as a plain name → value map, for injecting into the template scope. */
  map(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const s of this.list()) out[s.key] = s.value
    return out
  }
}
