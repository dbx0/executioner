import type { StateCreator } from 'zustand'
import type { AppState, OpenEngagement } from '../types.js'

type CreatorArgs = Parameters<StateCreator<AppState>>

/**
 * The shared closure the store's action slices were carved out of: zustand's
 * `set`/`get` plus the four helpers every slice used to reach through.
 */
export interface SliceCtx {
  set: CreatorArgs[0]
  get: CreatorArgs[1]
  /** Mutate the active engagement in place and re-mirror. */
  patchActive: (fn: (e: OpenEngagement) => OpenEngagement) => void
  /** Persist one engagement's open sessions so they can be restored on restart. */
  persistSessions: (root: string | null) => void
  /** Persist one engagement's open file tabs so they (and their titles) come back. */
  persistFiles: (root: string | null) => void
  /** Persist one engagement's per-tab pin/color state. */
  persistTabMeta: (root: string | null) => void
  /** Persist one engagement's unsaved buffers and disk baselines. */
  persistEditorState: (root: string | null) => void
}
