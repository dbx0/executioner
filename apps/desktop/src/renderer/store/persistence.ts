import type { ItemRef, PaneNode } from '../lib/pane-tree.js'
import { isKnownTheme, DEFAULT_THEME } from '../lib/themes.js'
import type {
  DiskBaseline,
  ExecutionMode,
  FileTab,
  Layout,
  OpenEngagement,
  PersistedFile,
  PersistedSession,
  Recent,
  RightTab,
  Session,
  TabMeta,
  Theme,
} from './types.js'

const THEME_KEY = 'exe.theme'
const DEFAULT_AGENT_KEY = 'exe.defaultAgent'
const DEFAULT_EXEC_KEY = 'exe.defaultExecution'
const ONBOARDED_KEY = 'exe.onboarded'
const TOURS_SEEN_KEY = 'exe.toursSeen'
const RIGHT_COLLAPSED_KEY = 'exe.rightSidebarCollapsed'
const RIGHT_TAB_KEY = 'exe.activeRightTab'
const RECENTS_KEY = 'exe.recents'
const OPEN_KEY = 'exe.openEngagements'
const ACTIVE_ROOT_KEY = 'exe.activeRoot'

/** Persist only the stable, serializable session shape: open roots + active root. */
export function saveSession(open: OpenEngagement[], activeRoot: string | null): void {
  saveSessionRoots(
    open.map((e) => e.root),
    activeRoot,
  )
}

/**
 * Persist the remembered roots directly. Used by the startup restore, which has
 * to keep a root whose engine failed to start: it is still one of the user's
 * open engagements, and there is no live engagement object to carry it.
 */
export function saveSessionRoots(roots: string[], activeRoot: string | null): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(roots))
    if (activeRoot === null) localStorage.removeItem(ACTIVE_ROOT_KEY)
    else localStorage.setItem(ACTIVE_ROOT_KEY, activeRoot)
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(): { roots: string[]; activeRoot: string | null } {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown)
    const roots = Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : []
    return { roots, activeRoot: localStorage.getItem(ACTIVE_ROOT_KEY) }
  } catch {
    return { roots: [], activeRoot: null }
  }
}

/** localStorage key holding one engagement's open sessions, keyed by its root. */
const SESSIONS_KEY_PREFIX = 'exe.sessions:'
function sessionsKey(root: string): string {
  return `${SESSIONS_KEY_PREFIX}${root}`
}

/** Reduce a live Session to its persisted shape (exactOptionalPropertyTypes: attach optionals only when set). */
export function toPersistedSession(s: Session): PersistedSession {
  const p: PersistedSession = { id: s.id, label: s.label, agent: s.agent }
  if (s.title !== undefined && s.title !== '') p.title = s.title
  if (s.resume !== undefined && s.resume !== '') p.resume = s.resume
  return p
}

export function saveSessions(root: string, sessions: Session[]): void {
  try {
    localStorage.setItem(sessionsKey(root), JSON.stringify(sessions.map(toPersistedSession)))
  } catch {
    /* storage unavailable */
  }
}

export function loadSessions(root: string): PersistedSession[] {
  try {
    const raw = localStorage.getItem(sessionsKey(root))
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is PersistedSession =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as PersistedSession).id === 'string' &&
        typeof (s as PersistedSession).label === 'string' &&
        typeof (s as PersistedSession).agent === 'string',
    )
  } catch {
    return []
  }
}

/** localStorage key holding one engagement's open file tabs, keyed by its root. */
const FILES_KEY_PREFIX = 'exe.files:'
function filesKey(root: string): string {
  return `${FILES_KEY_PREFIX}${root}`
}

/** Reduce a live FileTab to its persisted shape (attach optionals only when set). */
export function toPersistedFile(f: FileTab): PersistedFile {
  const p: PersistedFile = { id: f.id, path: f.path, name: f.name }
  if (f.title !== undefined && f.title !== '') p.title = f.title
  return p
}

export function saveFiles(root: string, files: FileTab[]): void {
  try {
    localStorage.setItem(filesKey(root), JSON.stringify(files.map(toPersistedFile)))
  } catch {
    /* storage unavailable */
  }
}

export function loadFiles(root: string): PersistedFile[] {
  try {
    const raw = localStorage.getItem(filesKey(root))
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is PersistedFile =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as PersistedFile).id === 'string' &&
        typeof (f as PersistedFile).path === 'string' &&
        typeof (f as PersistedFile).name === 'string',
    )
  } catch {
    return []
  }
}

/** localStorage key holding one engagement's workspace layouts, keyed by its root. */
const LAYOUTS_KEY_PREFIX = 'exe.layouts:'
function layoutsKey(root: string): string {
  return `${LAYOUTS_KEY_PREFIX}${root}`
}

export function saveLayouts(root: string, layouts: Layout[], activeLayoutId: string | null): void {
  try {
    localStorage.setItem(layoutsKey(root), JSON.stringify({ layouts, activeLayoutId }))
  } catch {
    /* storage unavailable */
  }
}

function parseItem(raw: unknown): ItemRef | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object') return undefined
  const { kind, id } = raw as { kind?: unknown; id?: unknown }
  return typeof kind === 'string' && typeof id === 'string' ? { kind, id } : undefined
}

/** The same bounds `setRatio` enforces while dragging a divider. */
const MIN_SAVED_RATIO = 0.1
const MAX_SAVED_RATIO = 0.9

/** A pane tree rebuilt field by field, or null when any part of it is malformed. */
function parsePaneNode(raw: unknown): PaneNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const n = raw as Record<string, unknown>
  if (n.type === 'leaf') {
    const item = parseItem(n.item)
    return typeof n.id === 'string' && item !== undefined ? { type: 'leaf', id: n.id, item } : null
  }
  if (n.type === 'split' && (n.dir === 'row' || n.dir === 'col') && typeof n.ratio === 'number') {
    const a = parsePaneNode(n.a)
    const b = parsePaneNode(n.b)
    // A hand-edited or overflowed ratio must not break the geometry: non-finite becomes an even split.
    const ratio = Number.isFinite(n.ratio) ? Math.min(MAX_SAVED_RATIO, Math.max(MIN_SAVED_RATIO, n.ratio)) : 0.5
    return a !== null && b !== null ? { type: 'split', dir: n.dir, ratio, a, b } : null
  }
  return null
}

/** The saved layouts, or null when none were saved (an engagement from before splits) or the data is unusable. */
export function loadLayouts(root: string): { layouts: Layout[]; activeLayoutId: string | null } | null {
  try {
    const raw = localStorage.getItem(layoutsKey(root))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { layouts: rawLayouts, activeLayoutId } = parsed as { layouts?: unknown; activeLayoutId?: unknown }
    if (!Array.isArray(rawLayouts)) return null
    const layouts: Layout[] = []
    for (const l of rawLayouts as unknown[]) {
      if (typeof l !== 'object' || l === null) continue
      const { id, root: rawRoot, focusedLeafId } = l as { id?: unknown; root?: unknown; focusedLeafId?: unknown }
      const tree = parsePaneNode(rawRoot)
      if (typeof id !== 'string' || tree === null) continue
      // A missing focus is repaired when the layouts are reconciled, so the layout itself stays.
      layouts.push({ id, root: tree, focusedLeafId: typeof focusedLeafId === 'string' ? focusedLeafId : '' })
    }
    return { layouts, activeLayoutId: typeof activeLayoutId === 'string' ? activeLayoutId : null }
  } catch {
    return null
  }
}

/** localStorage key holding one engagement's per-tab pin/color state, keyed by root. */
const TABMETA_KEY_PREFIX = 'exe.tabMeta:'
function tabMetaStorageKey(root: string): string {
  return `${TABMETA_KEY_PREFIX}${root}`
}

/** Reduce a TabMeta to its persisted shape, omitting unset optionals. */
function toPersistedTabMeta(m: TabMeta): TabMeta {
  const p: TabMeta = {}
  if (m.pinned === true) p.pinned = true
  if (m.color !== undefined && m.color !== '') p.color = m.color
  return p
}

export function saveTabMeta(root: string, meta: Record<string, TabMeta>): void {
  try {
    // Keep only entries that actually carry state, so cleared tabs don't linger.
    const out: Record<string, TabMeta> = {}
    for (const [k, v] of Object.entries(meta)) {
      const p = toPersistedTabMeta(v)
      if (p.pinned === true || p.color !== undefined) out[k] = p
    }
    localStorage.setItem(tabMetaStorageKey(root), JSON.stringify(out))
  } catch {
    /* storage unavailable */
  }
}

export function loadTabMeta(root: string): Record<string, TabMeta> {
  try {
    const raw = localStorage.getItem(tabMetaStorageKey(root))
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, TabMeta> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue
      const rec = v as { pinned?: unknown; color?: unknown }
      const m: TabMeta = {}
      if (rec.pinned === true) m.pinned = true
      if (typeof rec.color === 'string' && rec.color !== '') m.color = rec.color
      if (m.pinned === true || m.color !== undefined) out[k] = m
    }
    return out
  } catch {
    return {}
  }
}

export function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    return raw === null ? [] : (JSON.parse(raw) as Recent[])
  } catch {
    return []
  }
}

export function saveRecents(recents: Recent[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 12)))
  } catch {
    /* storage unavailable */
  }
}

export function loadRightCollapsed(): boolean {
  try {
    // Default collapsed so the panel is opt-in on first launch.
    return localStorage.getItem(RIGHT_COLLAPSED_KEY) !== 'false'
  } catch {
    return true
  }
}

/** Persist the right sidebar's collapsed flag (from the toggle action). */
export function saveRightCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RIGHT_COLLAPSED_KEY, collapsed ? 'true' : 'false')
  } catch {
    /* storage unavailable */
  }
}

export function loadRightTab(): RightTab {
  try {
    const saved = localStorage.getItem(RIGHT_TAB_KEY)
    if (saved === 'explorer' || saved === 'targets' || saved === 'sessions' || saved === 'executions' || saved === 'git')
      return saved
  } catch {
    /* ignore */
  }
  return 'explorer'
}

/** Persist the active right-sidebar tab, and expand the sidebar with it. */
export function saveRightTab(t: RightTab): void {
  try {
    localStorage.setItem(RIGHT_TAB_KEY, t)
    localStorage.setItem(RIGHT_COLLAPSED_KEY, 'false')
  } catch {
    /* storage unavailable */
  }
}

export function loadDefaultAgent(): string | null {
  try {
    return localStorage.getItem(DEFAULT_AGENT_KEY)
  } catch {
    return null
  }
}

export function saveDefaultAgent(id: string): void {
  try {
    localStorage.setItem(DEFAULT_AGENT_KEY, id)
  } catch {
    /* ignore */
  }
}

export function loadDefaultExecution(): ExecutionMode {
  try {
    const v = localStorage.getItem(DEFAULT_EXEC_KEY)
    if (v === 'local' || v === 'ssh' || v === 'docker') return v
  } catch {
    /* ignore */
  }
  return 'local'
}

export function saveDefaultExecution(m: ExecutionMode): void {
  try {
    localStorage.setItem(DEFAULT_EXEC_KEY, m)
  } catch {
    /* ignore */
  }
}

/** First launch = the onboarding flow has never been completed. */
export function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, 'true')
  } catch {
    /* ignore */
  }
}

/** The page tours already walked through (or skipped), by tour id. */
export function loadToursSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOURS_SEEN_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function saveToursSeen(ids: string[]): void {
  try {
    localStorage.setItem(TOURS_SEEN_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved !== null && isKnownTheme(saved)) return saved
  } catch {
    /* ignore */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return DEFAULT_THEME
  }
}

export function saveTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* ignore */
  }
}

/**
 * The backend a run should use, remembered per engagement. Shared by the canvas
 * run panel and the Workflows page so both agree; without it the picker resets
 * to 'local' and a workflow silently runs on this machine, where the tools
 * generally aren't installed.
 */
const RUN_BACKEND_PREFIX = 'exe.runBackend:'

export function loadRunBackend(root: string | null): string {
  if (root === null) return 'local'
  try {
    return localStorage.getItem(RUN_BACKEND_PREFIX + root) ?? 'local'
  } catch {
    return 'local'
  }
}

export function saveRunBackend(root: string | null, id: string): void {
  if (root === null) return
  try {
    if (id === 'local') localStorage.removeItem(RUN_BACKEND_PREFIX + root)
    else localStorage.setItem(RUN_BACKEND_PREFIX + root, id)
  } catch {
    /* storage unavailable */
  }
}

/** localStorage key holding one engagement's unsaved editor state, keyed by its root. */
const EDITOR_KEY_PREFIX = 'exe.editor:'
function editorKey(root: string): string {
  return `${EDITOR_KEY_PREFIX}${root}`
}

/**
 * Persist unsaved buffers and their disk baselines. Drafts are the user's
 * unwritten work, so losing them to a crash or a quit is the failure this
 * exists to prevent; the baselines travel with them so a restored tab can
 * re-derive a conflict that already existed at shutdown.
 */
export function saveEditorState(
  root: string,
  drafts: Record<string, string>,
  baselines: Record<string, DiskBaseline>,
): void {
  try {
    localStorage.setItem(editorKey(root), JSON.stringify({ drafts, baselines }))
  } catch {
    /* storage unavailable */
  }
}

export function loadEditorState(root: string): {
  drafts: Record<string, string>
  baselines: Record<string, DiskBaseline>
} {
  try {
    const raw = localStorage.getItem(editorKey(root))
    if (raw === null) return { drafts: {}, baselines: {} }
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { drafts: {}, baselines: {} }
    const { drafts, baselines } = parsed as { drafts?: unknown; baselines?: unknown }
    return {
      drafts:
        typeof drafts === 'object' && drafts !== null ? (drafts as Record<string, string>) : {},
      baselines:
        typeof baselines === 'object' && baselines !== null
          ? (baselines as Record<string, DiskBaseline>)
          : {},
    }
  } catch {
    return { drafts: {}, baselines: {} }
  }
}

/** Whether the editor writes changes automatically. Off unless explicitly enabled. */
const EDITOR_AUTOSAVE_KEY = 'exe.editorAutoSave'

export function loadEditorAutoSave(): boolean {
  try {
    return localStorage.getItem(EDITOR_AUTOSAVE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveEditorAutoSave(enabled: boolean): void {
  try {
    localStorage.setItem(EDITOR_AUTOSAVE_KEY, enabled ? 'true' : 'false')
  } catch {
    /* storage unavailable */
  }
}
