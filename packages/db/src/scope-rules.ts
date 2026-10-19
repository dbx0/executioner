import { and, asc, eq, ne } from 'drizzle-orm'
import { isoNow, newId, scopePatternProblem, type ScopeEffect, type ScopeRule } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { scopeRules } from './tables.js'

export interface ScopeRuleInput {
  effect: ScopeEffect
  pattern: string
  note?: string
  source?: string
}

/** A stored rule carries where it came from and when, beyond what matching needs. */
export interface StoredScopeRule extends ScopeRule {
  source: string
  createdAt: string
}

const toRule = (row: typeof scopeRules.$inferSelect): StoredScopeRule => ({
  ...row,
  effect: row.effect as ScopeEffect,
})

/**
 * Folds a pattern to the spelling the matcher expects. Operators paste scope
 * tables verbatim, so a rule arrives as `https://smartfit.com` or `SMARTFIT.com.`
 * as often as it arrives clean. A pattern that names a path keeps it — that is
 * a url rule, and its path is the point.
 */
export function normaliseScopePattern(pattern: string): string {
  let text = pattern.trim().toLowerCase()
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//
  if (scheme.test(text)) {
    const withoutScheme = text.replace(scheme, '')
    // Keep it a url rule only when a path follows the host.
    const slash = withoutScheme.indexOf('/')
    text = slash === -1 || slash === withoutScheme.length - 1 ? withoutScheme.replace(/\/$/, '') : text
  }
  while (text.endsWith('.')) text = text.slice(0, -1)
  return text
}

export class ScopeRuleRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  /**
   * Idempotent on (effect, normalised pattern). Re-running a scope parse, or an
   * agent re-reading the same program page, must not pile up copies of the same
   * boundary. An include and an exclude of one pattern stay separate rows: that
   * pair is a real state, and the exclude wins when it is judged.
   */
  add(input: ScopeRuleInput): StoredScopeRule {
    const pattern = normaliseScopePattern(input.pattern)
    // A pattern the matcher could never match is worse than no rule: it sits in
    // the table looking like a boundary while judging nothing.
    const problem = scopePatternProblem(pattern)
    if (problem !== null) throw new Error(problem)

    const existing = this.orm
      .select()
      .from(scopeRules)
      .where(and(eq(scopeRules.effect, input.effect), eq(scopeRules.pattern, pattern)))
      .get()
    if (existing !== undefined) return toRule(existing)

    const rule: StoredScopeRule = {
      id: newId(),
      effect: input.effect,
      pattern,
      note: input.note ?? '',
      source: input.source ?? 'manual',
      createdAt: isoNow(),
    }
    this.orm.insert(scopeRules).values(rule).run()
    return rule
  }

  all(): StoredScopeRule[] {
    return this.orm
      .select()
      .from(scopeRules)
      .orderBy(asc(scopeRules.effect), asc(scopeRules.pattern))
      .all()
      .map(toRule)
  }

  get(id: string): StoredScopeRule | undefined {
    const row = this.orm.select().from(scopeRules).where(eq(scopeRules.id, id)).get()
    return row === undefined ? undefined : toRule(row)
  }

  update(id: string, patch: { pattern?: string; note?: string; effect?: ScopeEffect }): StoredScopeRule | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    const pattern = patch.pattern === undefined ? existing.pattern : normaliseScopePattern(patch.pattern)
    const problem = scopePatternProblem(pattern)
    if (problem !== null) throw new Error(problem)
    const effect = patch.effect ?? existing.effect

    const clash = this.orm
      .select({ id: scopeRules.id })
      .from(scopeRules)
      .where(and(eq(scopeRules.effect, effect), eq(scopeRules.pattern, pattern), ne(scopeRules.id, id)))
      .get()
    if (clash !== undefined) throw new Error(`a rule already ${effect}s "${pattern}"`)

    const note = patch.note ?? existing.note
    this.orm.update(scopeRules).set({ effect, pattern, note }).where(eq(scopeRules.id, id)).run()
    return { ...existing, effect, pattern, note }
  }

  remove(id: string): boolean {
    return this.orm.delete(scopeRules).where(eq(scopeRules.id, id)).run().changes > 0
  }
}
