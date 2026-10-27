import type { AxiosInstance } from 'axios'
import type { EngineConnection } from '../lib/connection.js'
import type { TerminalSpec } from '../api/terminals.js'

/** One ephemeral "phone-message" progress bubble from a scope parse. */
export interface ScopeBubble {
  id: number
  message: string
}

/** The live state of a "Start with AI" scope parse, keyed by its runId. */
export interface ScopeRunState {
  bubbles: ScopeBubble[]
  done: boolean
  error?: boolean
  summary?: { total: number; added: number; targets: { kind: string; value: string }[] }
}

/** Options for creating a brand-new engagement from the New-engagement modal. */
export interface CreateEngagementInput {
  dir: string
  name: string
  icon?: string
  /** A photo badge (PNG data URL) to store in the new engagement's folder. */
  photo?: string
  description?: string
  scope?: string
}

/** Which tab of the New-engagement modal is shown. */
export type NewEngagementTab = 'ai' | 'manual' | 'open'

export type ViewId = 'about' | 'scope' | 'targets' | 'findings' | 'workflows' | 'tools' | 'terminals' | 'settings'

/** Which tab the workflows/agents hub shows (both are the same `workflows` view). */
export type HubTab = 'workflows' | 'agents'
/** A named theme id (see lib/themes.ts); 'light'/'dark' remain the legacy set. */
export type Theme = string
export type SessionState = 'idle' | 'working'
/** Which section the right sidebar is showing (its activity tabs). */
export type RightTab = 'explorer' | 'targets' | 'sessions' | 'executions' | 'git'

export interface Recent {
  root: string
  name: string
  /** The engagement's emoji icon, once its metadata has been read. */
  icon?: string
  /** The engagement's photo badge as a PNG data URL, remembered so the
   *  Open-existing grid shows it without starting that engagement's engine. */
  photo?: string
  /** Epoch millis of the last time this engagement was opened. */
  lastOpenedAt?: number
}

export interface Session {
  id: string
  label: string
  agent: string
  /** A real conversation title derived from the agent's first prompt. */
  title?: string
  /**
   * The agent's own session id (for claude, the UUID from its transcript
   * filename), learned from a lifecycle hook. When present, restoring this
   * engagement resumes the conversation (`claude --resume <resume>`) instead of
   * starting the agent blank.
   */
  resume?: string
}

/** The cheap change hint for an open file: what a stat call reported. */
export interface DiskStat {
  mtimeMs: number
  size: number
}

/**
 * What we last knew to be on disk for one tab. The stat is a hint a poll can
 * afford; the signature is the authority that decides whether a conflict is
 * real. They are written together so they cannot drift.
 */
export interface DiskBaseline {
  stat: DiskStat
  signature: string
}

/** An unresolved change made to an open file by something other than this editor. */
export type ExternalMutation = 'changed' | 'deleted'

/** One opened file, shown as a tab in the workspace alongside terminal tabs. */
export interface FileTab {
  id: string
  /** Engagement-relative path, used both to read the file and to dedupe tabs. */
  path: string
  /** The filename (default display title). */
  name: string
  /** A user-set display title (from double-click rename); falls back to name. */
  title?: string
  /**
   * A preview (ephemeral) tab, opened by a single-click in the explorer. There is
   * at most one preview tab at a time; single-clicking another file replaces this
   * one in the same slot. It renders italic and is promoted to a permanent tab on
   * double-click (explorer or tab) or on the first edit. Not persisted — restored
   * tabs are always permanent.
   */
  preview?: boolean
  /** The editor holds unsaved changes. Not persisted; drives the tab's dirty dot. */
  dirty?: boolean
}

/** Which tab the unified workspace strip has selected: a terminal or a file. */
export type ActiveTab = { kind: 'terminal'; id: string } | { kind: 'file'; id: string }

/**
 * Per-tab presentation state that isn't part of the tab's identity: whether it's
 * pinned (protected from Close / bulk-close) and an optional accent color. Kept in
 * one map keyed by `${kind}:${id}` rather than on every Session/FileTab, and
 * persisted per engagement root alongside the session/file tabs.
 */
export interface TabMeta {
  pinned?: boolean
  color?: string
}

export interface Subagent {
  id: string
  description: string
  state: 'working' | 'done'
  /** The id of the sub-agent that spawned this one. Absent = a direct child of
   *  the lead agent (top level). Present = nested lineage: this row hangs under
   *  the sub-agent with that id, forming the recursive tree the sidebar renders.
   *  The flat list + parentId (rather than a nested structure) keeps the Zustand
   *  selector returning a stable array ref; the tree is derived at render. */
  parentId?: string
}

/** One open engagement: its engine connection and its live agent sessions. */
export interface OpenEngagement {
  root: string
  name: string
  /** An optional emoji icon (from config.json); the rail shows it over initials. */
  icon?: string
  /** An optional photo badge (from `.executioner/icon.png`) as a PNG data URL.
   *  It wins over the emoji, which in turn wins over the name's initials. */
  photo?: string
  connection: EngineConnection
  client: AxiosInstance
  sessions: Session[]
  activeSessionId: string | null
  sessionState: Record<string, SessionState>
  subagents: Record<string, Subagent[]>
  /** Files opened as tabs in this engagement's workspace. */
  files: FileTab[]
  /** The unified workspace selection: a terminal tab or a file tab (or none). */
  activeTab: ActiveTab | null
  /** Per-tab pin/color state, keyed by `${kind}:${id}`. */
  tabMeta: Record<string, TabMeta>
  /** Unsaved buffer per file-tab id. Outlives the editor component. */
  editorDrafts: Record<string, string>
  /** What we last knew to be on disk, per file-tab id. */
  diskBaselines: Record<string, DiskBaseline>
  /** Unresolved external mutations, per file-tab id. Drives the conflict banner. */
  externalMutation: Record<string, ExternalMutation>
}

/**
 * The serializable shape of one open session, persisted per engagement root so
 * the agent tabs come back on restart. `resume`, when known, resumes a claude
 * agent's conversation; a plain shell reopens fresh.
 */
export interface PersistedSession {
  id: string
  label: string
  agent: string
  title?: string
  resume?: string
}

/** The serializable shape of one open file tab, persisted per engagement root. */
export interface PersistedFile {
  id: string
  path: string
  name: string
  title?: string
}

/** The user's preferred execution backend kind, chosen during onboarding. */
export type ExecutionMode = 'local' | 'ssh' | 'docker'

export interface AppState {
  theme: Theme
  /** The agent pre-selected in the launchers, chosen during onboarding. */
  defaultAgent: string | null
  /** The preferred execution backend kind, chosen during onboarding. */
  defaultExecution: ExecutionMode
  /** Whether the first-launch onboarding modal is open. */
  onboardingOpen: boolean
  /** Page tours the user has finished or skipped, by tour id. */
  toursSeen: string[]
  /** Whether the "New engagement" modal is open. */
  newEngagementOpen: boolean
  /** Which tab that modal opens on (the callers that open it pick one). */
  newEngagementTab: NewEngagementTab
  /** Live scope-parse runs, keyed by runId (drives the AI tab's progress bubbles). */
  scopeRuns: Record<string, ScopeRunState>
  activeView: ViewId
  sidebarCollapsed: boolean
  /** The right sidebar is collapsed by default; a flag mirrors the left one. */
  rightSidebarCollapsed: boolean
  /** Which section the right sidebar shows. */
  activeRightTab: RightTab
  paletteOpen: boolean

  /** Deep-link request: a target the palette wants the Targets view to reveal.
   *  Set on selection, consumed and cleared once by TargetsView. */
  pendingTargetId: string | null

  /** Which tab the workflows/agents hub shows. Held in the store so the sidebar's
   *  Workflows and Agents entries can drive it. */
  hubTab: HubTab

  /** Deep-link request: an execution the sidebar wants the runs list to select.
   *  Set on click, consumed and cleared once by ExecutionsView. */
  pendingExecutionId: string | null

  /** Deep-link request: a finding to reveal on the Findings page (from a
   *  target's panel). Consumed and cleared once by FindingsView. */
  pendingFindingId: string | null

  /** Deep-link request: a target the Tools page should start with picked (from
   *  a target's right-click menu). Consumed and cleared once by ToolsView. */
  pendingToolTargetId: string | null

  /** Which Settings sub-section is active. Held in the store (not local state) so
   *  it can be deep-linked via `openSettings`. Null falls back to 'general'. */
  settingsSection: string | null

  /** Every open engagement, and which one is active. */
  open: OpenEngagement[]
  activeRoot: string | null

  // Flat mirror of the active engagement, so views stay simple.
  connection: EngineConnection | null
  client: AxiosInstance | null
  engagementName: string | null
  /** The active engagement's emoji icon, mirrored from OpenEngagement.icon. */
  engagementIcon: string | null
  /** The active engagement's photo badge, mirrored from OpenEngagement.photo. */
  engagementPhoto: string | null
  sessions: Session[]
  activeSessionId: string | null
  sessionState: Record<string, SessionState>
  subagents: Record<string, Subagent[]>
  files: FileTab[]
  activeTab: ActiveTab | null
  tabMeta: Record<string, TabMeta>
  /** Unsaved buffer per file-tab id. Outlives the editor component. */
  editorDrafts: Record<string, string>
  /** What we last knew to be on disk, per file-tab id. */
  diskBaselines: Record<string, DiskBaseline>
  /** Unresolved external mutations, per file-tab id. Drives the conflict banner. */
  externalMutation: Record<string, ExternalMutation>

  /** A global request to begin inline-renaming a tab (from the ⌘R shortcut or the
   *  "Change Title" menu item); the target tab consumes and clears it. */
  renameRequest: ActiveTab | null

  recents: Recent[]
  busy: boolean
  error: string | null

  /** Agent CLIs detected as installed on this machine (from GET /agents), or null
   *  before the check completes. Agent pickers filter to these once known. */
  installedAgents: string[] | null
  refreshAgents: () => void

  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setDefaultAgent: (id: string) => void
  setDefaultExecution: (m: ExecutionMode) => void
  /** Open the onboarding modal again (e.g. from Settings). */
  openOnboarding: () => void
  /** Finish onboarding: persist the completed flag and close the modal. */
  completeOnboarding: () => void
  /** Record a page tour as done, so it is not shown again. */
  markTourSeen: (id: string) => void
  /** Forget every finished tour, so each page shows its tour again. */
  resetTours: () => void
  setActiveView: (v: ViewId) => void
  setSettingsSection: (id: string) => void
  /** Jump to the Settings view, optionally deep-linking a sub-section. */
  openSettings: (section?: string) => void
  toggleSidebar: () => void
  toggleRightSidebar: () => void
  /** Open the right sidebar to a section (expanding it if collapsed). */
  setRightTab: (t: RightTab) => void
  setPalette: (open: boolean) => void
  setPendingTargetId: (id: string | null) => void
  /** Set which hub tab is shown (does not switch views on its own). */
  setHubTab: (t: HubTab) => void
  /** Open the workflows/agents hub to a given tab. */
  openHub: (t: HubTab) => void
  /** Open a specific execution in the runs list (navigates to the workflows hub). */
  openExecution: (id: string) => void
  setPendingExecutionId: (id: string | null) => void
  /** Open the Findings page with this finding selected. */
  openFinding: (id: string) => void
  setPendingFindingId: (id: string | null) => void
  /** Open the Tools page with this target picked. */
  openTools: (targetId: string) => void
  setPendingToolTargetId: (id: string | null) => void

  restoreSession: () => Promise<void>
  openEngagement: (create: boolean) => Promise<void>
  /**
   * Open the "New engagement" modal (from Landing, the rail, palette, sidebar)
   * on `tab` — "Open engagement" lands straight on the Open-existing tab.
   */
  openNewEngagement: (tab?: NewEngagementTab) => void
  closeNewEngagement: () => void
  /** Open the native folder picker and return the chosen dir (or undefined). */
  pickEngagementFolder: () => Promise<string | undefined>
  /**
   * Create a brand-new engagement from the modal: inits the folder (name, icon,
   * scaffold, description, scope) and opens it. Returns the connected root, or
   * null on failure (with `error` set), so the modal can proceed to add targets
   * or run the AI scope parse against the live engine.
   */
  createEngagement: (input: CreateEngagementInput) => Promise<string | null>
  /** Open an existing engagement folder by path (Tab 3). Returns its root or null. */
  openEngagementFolder: (dir: string) => Promise<string | null>
  /** Update the active engagement's name and/or icon (persists to config.json). */
  /**
   * Rename the active engagement or change its badge. `icon: ''` clears the
   * emoji; `photo: ''` deletes the stored photo. Setting one clears the other —
   * an engagement has a single badge.
   */
  updateEngagementMeta: (patch: { name?: string; icon?: string; photo?: string }) => Promise<void>
  /** Initialise an empty progress-bubble list for a scope run before it streams. */
  beginScopeRun: (runId: string) => void
  openRecent: (root: string) => Promise<void>
  switchEngagement: (root: string) => void
  closeEngagement: (root?: string) => void

  createSession: (spec: TerminalSpec) => Promise<void>
  closeSession: (id: string) => void
  setActiveSession: (id: string) => void
  pulseSession: (id: string) => void

  /**
   * Open a file as a workspace tab (dedupe by path), switch to the workspace.
   * With `{ preview: true }` it opens as a preview (ephemeral) tab, reusing the
   * single preview slot; a permanent open (default) promotes an already-open
   * preview of the same file.
   */
  openFile: (path: string, name: string, opts?: { preview: boolean }) => void
  /** Promote a preview tab to a permanent one (double-click / first edit). */
  promoteFileTab: (id: string) => void
  /** Set or clear a file tab's unsaved-changes flag (drives the dirty dot). */
  setFileDirty: (id: string, dirty: boolean) => void
  editorAutoSave: boolean
  setEditorAutoSave: (enabled: boolean) => void
  setEditorDraft: (id: string, content: string) => void
  clearEditorDraft: (id: string) => void
  setDiskBaseline: (id: string, baseline: DiskBaseline) => void
  clearDiskBaseline: (id: string) => void
  setExternalMutation: (id: string, mutation: ExternalMutation | null) => void
  closeFile: (id: string) => void
  /** Select any tab in the workspace strip (terminal or file). */
  setActiveTab: (tab: ActiveTab) => void
  /** Rename a terminal or file tab's display title (empty reverts to default). */
  renameTab: (tab: ActiveTab, title: string) => void
  /** Toggle a tab's pinned state (pinned tabs are protected from bulk-close). */
  toggleTabPin: (tab: ActiveTab) => void
  /** Set (or, with undefined, clear) a tab's accent color. */
  setTabColor: (tab: ActiveTab, color: string | undefined) => void
  /** Ask the given tab to enter inline rename (⌘R / "Change Title"). */
  requestTabRename: (tab: ActiveTab) => void
  /** Clear a consumed rename request. */
  clearTabRename: () => void
  /** Close every tab except `tab` (pinned tabs are never closed). */
  closeOtherTabs: (tab: ActiveTab) => void
  /** Close every tab to the right of `tab` (pinned tabs are never closed). */
  closeTabsToRight: (tab: ActiveTab) => void
  /** Close every tab to the left of `tab` (pinned tabs are never closed). */
  closeTabsToLeft: (tab: ActiveTab) => void

  handleAgentEvent: (sessionId: string, event: string, payload: Record<string, unknown>) => void
}
