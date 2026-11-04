/// <reference types="vite/client" />
import type { EngineConnection } from './lib/connection.js'
import type { BackendProfileInput, BackendTestResult, SshEnrollResult } from './api/backends.js'
import type { ConnectionHints } from '../main/connection-hints.js'
import type { UpdateInfo } from '../main/update.js'
import type { BrowserState } from '../main/browser/page.js'
import type { SessionInfo } from '../main/logging/session-log.js'
import type { LogLevel, LogLine } from '@exe/protocol'

declare global {
  /** The app version from package.json, injected at build time. */
  const __APP_VERSION__: string

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
      /** Embedded browser. Main owns the native views; this reports where a pane
       *  sits (null = not on screen), hides them under overlays, drives the address
       *  bar and delivers each page's state. */
      browser: {
        place(req: { root: string; id: string; bounds: { x: number; y: number; width: number; height: number } | null }): void
        setOccluded(occluded: boolean): void
        operator(req: {
          root: string
          id: string
          op: 'back' | 'forward' | 'reload' | 'stop' | { navigate: string }
        }): Promise<void>
        onState(listener: (e: { root: string; id: string; state: BrowserState }) => void): () => void
      }
      /** A newer release than the running one, or null when up to date or offline. */
      checkForUpdate(): Promise<UpdateInfo | null>
      /** Download and verify the release found by checkForUpdate; resolves when it is ready. */
      downloadUpdate(): Promise<void>
      /** Subscribe to downloadUpdate's progress; returns the unsubscribe. */
      onUpdateProgress(listener: (p: { received: number; total: number | null }) => void): () => void
      /** Quit and install the downloaded release, then reopen. */
      installUpdate(): Promise<void>
      /** Drive the startup splash: restore progress (0 to 1), then ready to show the app. */
      startup: {
        progress(fraction: number): void
        ready(): void
      }
      /** Match the native window appearance (macOS traffic lights) to the theme base. */
      setAppearance(mode: 'light' | 'dark'): void
      /** App log. Main owns the session file and masks every line before writing it. */
      log: {
        /** Fire-and-forget; main stamps the time and forces `src` to `renderer` or `renderer/<sub>`. */
        write(line: { lvl: LogLevel; src?: string; msg: string; data?: Record<string, unknown> }): void
        /** Every retained session, oldest first. */
        sessions(): Promise<SessionInfo[]>
        /** This app instance's own session, or null when logging is unavailable. */
        currentSession(): Promise<SessionInfo | null>
        /** A session's lines (the last `limit` when given). */
        read(req: { id: string; limit?: number }): Promise<LogLine[]>
        /** Whether this session logs at debug (the saved switch or the launch flag). */
        getVerbose(): Promise<boolean>
        /** Save the switch and apply it now to main, the renderer and every running engine. */
        setVerbose(verbose: boolean): Promise<void>
        /** Reload the secret values logs are masked with, after a secret or connection changes. */
        refreshMasks(): void
        /** Open the logs folder in the system file manager; resolves to an error string or ''. */
        openFolder(): Promise<string>
        /** The previous session, when it ended without a clean shutdown. */
        previousCrash(): Promise<SessionInfo | null>
        /** Save a zip of logs for a bug report through the native save dialog. */
        exportLogs(req: {
          includeAllSessions: boolean
          includeTargets: boolean
          sessionId?: string
        }): Promise<{ saved: string } | { cancelled: true }>
        /** Subscribe to log level changes; returns the unsubscribe. */
        onLevel(listener: (level: LogLevel) => void): () => void
      }
      /** process.platform of the main process; macOS keeps native traffic lights,
       *  everywhere else the titlebar draws its own window controls. */
      platform: string
      windowControl(action: 'minimize' | 'maximize' | 'close'): void
      /** Main asks before any close or quit; returns the unsubscribe. */
      onConfirmClose(listener: () => void): () => void
      /** Tell main the confirm dialog is up, so it skips its native fallback. */
      closeConfirmShown(): void
      /** The user's answer: true closes (or quits), false keeps the app open. */
      answerClose(ok: boolean): void
      /** Subscribe to maximize/unmaximize; returns the unsubscribe. */
      onMaximizedChange(listener: (maximized: boolean) => void): () => void
    }
  }
}

export {}
