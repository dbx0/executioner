import { saveRecents } from './persistence.js'
import type { ActiveTab, AppState, FileTab, OpenEngagement, Recent } from './types.js'

/** The map key for a tab's metadata entry. */
export function tabMetaKey(tab: ActiveTab): string {
  return `${tab.kind}:${tab.id}`
}

/** Monotonic counter so two files opened in the same millisecond get distinct ids. */
let fileSeq = 0
export function nextFileId(): string {
  fileSeq += 1
  return `file-${Date.now()}-${fileSeq}`
}

/**
 * Rebuild a FileTab, carrying its stable identity/title forward while overriding
 * the ephemeral `preview`/`dirty` flags (exactOptionalPropertyTypes: attach a
 * flag only when true, so a cleared flag leaves no `undefined` behind).
 */
export function fileWithFlags(base: FileTab, flags: { preview?: boolean; dirty?: boolean }): FileTab {
  const next: FileTab = { id: base.id, path: base.path, name: base.name }
  if (base.title !== undefined && base.title !== '') next.title = base.title
  const preview = flags.preview ?? base.preview
  const dirty = flags.dirty ?? base.dirty
  if (preview === true) next.preview = true
  if (dirty === true) next.dirty = true
  return next
}

/** The stem of a claude transcript path is the agent's own session UUID — the resume id. */
export function transcriptStem(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? 'engagement'
}

export function rememberRecent(recents: Recent[], entry: Recent): Recent[] {
  const previous = recents.find((r) => r.root === entry.root)
  // Metadata (the badge) arrives after the open, so keep what we already knew.
  const merged: Recent = { ...previous, ...entry, lastOpenedAt: Date.now() }
  const next = [merged, ...recents.filter((r) => r.root !== entry.root)].slice(0, 12)
  saveRecents(next)
  return next
}

/**
 * Patch the name and badge of one remembered engagement, leaving the order
 * untouched. A field left out is left as it was; passing `null` (or an empty
 * string) clears it — a photo deleted from the engagement folder has to
 * disappear from the Open-existing grid too, but only when the folder was
 * actually read, never because a lookup failed.
 */
export function patchRecent(
  recents: Recent[],
  root: string,
  meta: { name?: string; icon?: string | null; photo?: string | null },
): Recent[] {
  const next = recents.map((r) => {
    if (r.root !== root) return r
    const entry: Recent = { ...r }
    if (meta.name !== undefined && meta.name !== '') entry.name = meta.name
    if (meta.icon !== undefined) {
      if (meta.icon !== null && meta.icon !== '') entry.icon = meta.icon
      else delete entry.icon
    }
    if (meta.photo !== undefined) {
      if (meta.photo !== null && meta.photo !== '') entry.photo = meta.photo
      else delete entry.photo
    }
    return entry
  })
  saveRecents(next)
  return next
}

/** Project the active engagement onto the flat mirror fields. */
export function mirror(open: OpenEngagement[], activeRoot: string | null): Pick<
  AppState,
  | 'connection'
  | 'client'
  | 'engagementName'
  | 'engagementIcon'
  | 'engagementPhoto'
  | 'sessions'
  | 'activeSessionId'
  | 'sessionState'
  | 'subagents'
  | 'files'
  | 'activeTab'
  | 'tabMeta'
  | 'editorDrafts'
  | 'diskBaselines'
  | 'externalMutation'
> {
  const a = open.find((e) => e.root === activeRoot)
  if (a === undefined) {
    return {
      connection: null,
      client: null,
      engagementName: null,
      engagementIcon: null,
      engagementPhoto: null,
      sessions: [],
      activeSessionId: null,
      sessionState: {},
      subagents: {},
      files: [],
      activeTab: null,
      tabMeta: {},
      editorDrafts: {},
      diskBaselines: {},
      externalMutation: {},
    }
  }
  return {
    connection: a.connection,
    client: a.client,
    engagementName: a.name,
    engagementIcon: a.icon ?? null,
    engagementPhoto: a.photo ?? null,
    sessions: a.sessions,
    activeSessionId: a.activeSessionId,
    sessionState: a.sessionState,
    subagents: a.subagents,
    files: a.files,
    activeTab: a.activeTab,
    tabMeta: a.tabMeta,
    editorDrafts: a.editorDrafts,
    diskBaselines: a.diskBaselines,
    externalMutation: a.externalMutation,
  }
}
