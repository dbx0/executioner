/**
 * The renderer's global store. The implementation lives in `store/` (types,
 * the localStorage adapter, pure helpers and the action slices); this module is
 * the stable public surface every view imports from.
 */
export type {
  ActiveTab,
  AppState,
  CreateEngagementInput,
  ExecutionMode,
  FileTab,
  HubTab,
  OpenEngagement,
  PersistedFile,
  PersistedSession,
  Recent,
  RightTab,
  ScopeBubble,
  ScopeRunState,
  Session,
  SessionState,
  Subagent,
  TabMeta,
  Theme,
  ViewId,
} from './store/types.js'
export { nextFileId, tabMetaKey, transcriptStem } from './store/helpers.js'
export {
  loadFiles,
  loadSessions,
  loadTabMeta,
  saveFiles,
  saveSessions,
  saveTabMeta,
  toPersistedFile,
  toPersistedSession,
} from './store/persistence.js'
export { useApp } from './store/create.js'
