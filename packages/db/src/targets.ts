import { asc, eq, inArray } from 'drizzle-orm'
import {
  canonicaliseAsset,
  evaluateScope,
  isCanonicalAsset,
  isoNow,
  newId,
  type CanonicalAsset,
  type ScopeRule,
  type ScopeStatus,
  type Target,
  type TargetKind,
} from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { scopeRules, targets } from './tables.js'

export interface UpsertTargetInput {
  /** A hint about how to read the value. The value itself decides the kind. */
  kind: TargetKind
  value: string
  source: string
  parentId?: string | null
}

type TargetRow = typeof targets.$inferSelect

const toTarget = (row: TargetRow): Target => ({
  ...row,
  kind: row.kind as TargetKind,
  scopeStatus: row.scopeStatus as ScopeStatus,
})

/** The source recorded for an apex the tree invented to hang a subdomain on. */
export const DERIVED_SOURCE = 'derived'

export class TargetRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  /**
   * The boundary as the matcher wants it. Read per admission rather than cached:
   * the table holds a handful of rows, several engines share one database file,
   * and a stale cache would silently judge an asset against a rule an operator
   * has already deleted.
   */
  private rules(): ScopeRule[] {
    const rows = this.orm
      .select({ id: scopeRules.id, effect: scopeRules.effect, pattern: scopeRules.pattern, note: scopeRules.note })
      .from(scopeRules)
      .all()
    return rows.map((r) => ({ ...r, effect: r.effect as ScopeRule['effect'] }))
  }

  private rowByValue(value: string): TargetRow | undefined {
    return this.orm.select().from(targets).where(eq(targets.value, value)).get()
  }

  /**
   * Looks a target up by value. `kind` is accepted for call-site readability and
   * to canonicalise the spelling, but does not narrow the search: one value is
   * one asset, whatever kind the caller believes it to be.
   */
  findByValue(kind: TargetKind, value: string): Target | undefined {
    const asset = canonicaliseAsset({ kind, value })
    const row = this.rowByValue(isCanonicalAsset(asset) ? asset.value : value.trim())
    return row === undefined ? undefined : toTarget(row)
  }

  /**
   * Finds, or invents, the target an asset hangs under: a url belongs to its
   * host, a subdomain to its apex. An invented apex is marked `derived` so the
   * tree never implies someone put it in the engagement deliberately.
   */
  private resolveParentId(asset: CanonicalAsset): string | null {
    const owner =
      asset.kind === 'url' ? asset.host : asset.kind === 'subdomain' ? asset.apex : null
    if (owner === null || owner === asset.value) return null

    const existing = this.rowByValue(owner)
    if (existing !== undefined) return existing.id
    return this.insert({ kind: 'domain', value: owner, source: DERIVED_SOURCE }).id
  }

  private insert(input: UpsertTargetInput): Target {
    const asset = canonicaliseAsset(input)
    if (!isCanonicalAsset(asset)) throw new Error(asset.error)

    // A second writer may have inserted this value between the caller's check
    // and ours; the unique index makes that a lost race rather than a duplicate.
    const raced = this.rowByValue(asset.value)
    if (raced !== undefined) return toTarget(raced)

    const verdict = evaluateScope(asset, this.rules())
    const now = isoNow()
    const parentId = this.resolveParentId(asset) ?? input.parentId ?? null

    const target: Target = {
      id: newId(),
      kind: asset.kind,
      value: asset.value,
      apex: asset.apex,
      // Never hang a target off itself, however the caller asked.
      parentId: parentId === null ? null : parentId,
      source: input.source,
      scopeStatus: verdict.status,
      scopeReason: verdict.reason,
      firstSeen: now,
      lastSeen: now,
    }

    this.orm.insert(targets).values(target).run()

    return target
  }

  /**
   * The single door into the target tree. Everything that discovers an asset —
   * a node's emit block, an agent's MCP call, the HTTP route, a scope parse —
   * arrives here, so canonical identity, parentage and the scope verdict are
   * decided in one place and cannot be routed around.
   *
   * Idempotent on the canonical value. On re-discovery the row keeps its id,
   * first_seen and original source, refreshes last_seen, adopts a parent only if
   * it did not already have one, and re-derives its kind — a host first seen as
   * a bare name and later as an apex is corrected in place rather than copied.
   *
   * Throws when the value is malformed (a wildcard, a bad address, a url with no
   * scheme). Being outside the engagement's scope never throws: the asset is
   * stored with its verdict, because a scope paste is routinely incomplete and
   * silently dropping a host is how a real finding gets missed.
   */
  upsert(input: UpsertTargetInput): Target {
    const asset = canonicaliseAsset(input)
    if (!isCanonicalAsset(asset)) throw new Error(asset.error)

    const existing = this.rowByValue(asset.value)
    if (existing === undefined) return this.insert(input)

    const now = isoNow()
    const parentId =
      existing.parentId ?? this.resolveParentId(asset) ?? input.parentId ?? null
    const verdict = evaluateScope(asset, this.rules())

    this.orm
      .update(targets)
      .set({
        lastSeen: now,
        parentId,
        kind: asset.kind,
        apex: asset.apex,
        scopeStatus: verdict.status,
        scopeReason: verdict.reason,
      })
      .where(eq(targets.id, existing.id))
      .run()

    return {
      ...toTarget(existing),
      kind: asset.kind,
      apex: asset.apex,
      parentId,
      scopeStatus: verdict.status,
      scopeReason: verdict.reason,
      lastSeen: now,
    }
  }

  /**
   * Re-judges every target against the current rules and returns how many
   * changed verdict. Called after the boundary is edited, so adding an exclusion
   * retroactively flags what it covers instead of only affecting future writes.
   */
  reevaluateScope(): number {
    const rules = this.rules()
    let changed = 0
    this.orm.transaction((tx) => {
      for (const row of tx.select().from(targets).all()) {
        const asset = canonicaliseAsset({ kind: row.kind, value: row.value })
        if (!isCanonicalAsset(asset)) continue
        const verdict = evaluateScope(asset, rules)
        if (verdict.status === row.scopeStatus && verdict.reason === row.scopeReason) continue
        tx.update(targets)
          .set({ scopeStatus: verdict.status, scopeReason: verdict.reason })
          .where(eq(targets.id, row.id))
          .run()
        changed += 1
      }
    })
    return changed
  }

  all(): Target[] {
    return this.orm.select().from(targets).orderBy(asc(targets.value)).all().map(toTarget)
  }

  get(id: string): Target | undefined {
    const row = this.orm.select().from(targets).where(eq(targets.id, id)).get()
    return row === undefined ? undefined : toTarget(row)
  }

  /**
   * Rename a target. The kind follows from the new value, so a caller's `kind`
   * is only a hint here too. Rejects a rename onto a value that already exists.
   */
  update(id: string, patch: { kind?: TargetKind; value?: string }): Target | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined

    const asset = canonicaliseAsset({
      kind: patch.kind ?? existing.kind,
      value: patch.value ?? existing.value,
    })
    if (!isCanonicalAsset(asset)) throw new Error(asset.error)

    const clash = this.rowByValue(asset.value)
    if (clash !== undefined && clash.id !== id) {
      throw new Error(`a target "${asset.value}" already exists`)
    }

    const verdict = evaluateScope(asset, this.rules())
    const now = isoNow()
    this.orm
      .update(targets)
      .set({
        kind: asset.kind,
        value: asset.value,
        apex: asset.apex,
        scopeStatus: verdict.status,
        scopeReason: verdict.reason,
        lastSeen: now,
      })
      .where(eq(targets.id, id))
      .run()

    return {
      ...existing,
      kind: asset.kind,
      value: asset.value,
      apex: asset.apex,
      scopeStatus: verdict.status,
      scopeReason: verdict.reason,
      lastSeen: now,
    }
  }

  /**
   * Delete a target and all of its descendants (subdomains discovered under it).
   * Facts cascade via the schema's ON DELETE CASCADE. Returns the number of
   * target rows removed.
   */
  removeSubtree(id: string): number {
    const rows = this.orm.select({ id: targets.id, parentId: targets.parentId }).from(targets).all()
    if (!rows.some((r) => r.id === id)) return 0
    const childrenOf = new Map<string | null, string[]>()
    for (const r of rows) {
      const list = childrenOf.get(r.parentId) ?? []
      list.push(r.id)
      childrenOf.set(r.parentId, list)
    }
    const doomed: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      doomed.push(current)
      for (const child of childrenOf.get(current) ?? []) stack.push(child)
    }
    // Chunked: SQLite caps the number of bound parameters in one statement.
    this.orm.transaction((tx) => {
      for (let i = 0; i < doomed.length; i += 500) {
        tx.delete(targets).where(inArray(targets.id, doomed.slice(i, i + 500))).run()
      }
    })
    return doomed.length
  }
}
