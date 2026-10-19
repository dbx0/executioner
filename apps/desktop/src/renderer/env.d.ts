/// <reference types="vite/client" />
import type { EngineConnection } from './lib/connection.js'
import type { BackendProfileInput, BackendTestResult, SshEnrollResult } from './api/backends.js'
import type { ConnectionHints } from '../main/connection-hints.js'

declare global {
  interface Window {
    executioner: {
      pickFolder(): Promise<string | undefined>
      openProject(req: {
        dir: string
        create: boolean
        name?: string
        icon?: string
        description?: string
        scope?: string
      }): Promise<EngineConnection>
      /** Stop the engine for an engagement being closed. Other engagements'
       *  engines keep running. */
      closeProject(req: { dir: string }): void
      /** Probe which agent CLIs are installed on PATH, before any engagement. */
      checkAgents(): Promise<{ id: string; installed: boolean }[]>
      /** Liveness-test a backend with no engagement open — the engine runs one-shot. */
      testBackend(req: { profile: BackendProfileInput; createWorkdir?: boolean }): Promise<BackendTestResult>
      /** Generate + install an SSH key with no engagement open. */
      enrollSsh(req: { host: string; user: string; password: string; port?: number }): Promise<SshEnrollResult>
      /** Values the connection form prefills from: ~/.ssh config + keys, username,
       *  and locally pulled docker images. */
      connectionHints(): Promise<ConnectionHints>
      /** Pick an image and get it back as a small square PNG data URL (null when
       *  cancelled or unreadable). No engagement needs to exist yet. */
      pickEngagementPhoto(): Promise<string | null>
      /** The photo badge stored in an engagement folder, read fresh off disk. */
      readEngagementPhoto(req: { root: string }): Promise<string | null>
      /** Store a photo badge inside the engagement folder; returns what was stored. */
      writeEngagementPhoto(req: { root: string; dataUrl: string }): Promise<string | null>
      /** Remove an engagement's photo badge. */
      clearEngagementPhoto(req: { root: string }): void
      /** Terminal clipboard: xterm consumes Ctrl+V as ^V, so paste is wired by
       *  hand. Served by the main process, hence asynchronous. */
      clipboardRead(): Promise<string>
      clipboardWrite(text: string): Promise<void>
      /** Match the native window appearance (macOS traffic lights) to the theme base. */
      setAppearance(mode: 'light' | 'dark'): void
    }
  }
}

export {}
