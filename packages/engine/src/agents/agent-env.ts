/**
 * Environment hygiene for the processes the engine spawns into PTYs.
 *
 * Everything the engine starts inherits the engine's own environment, which is
 * whatever Executioner itself was launched with. That is fine until the app is
 * started from inside a Claude Code session — running `pnpm dev` from a Claude
 * terminal is the obvious way to hit it — because Claude Code stamps the
 * conversation it belongs to into its children. A `claude` spawned with those
 * stamps believes it is a nested child session and silently stops writing a
 * transcript, which is where the app reads each agent's resume id from, so its
 * conversation cannot be restored afterwards.
 */

/**
 * The stamps that identify an *outer* Claude Code conversation.
 *
 * Deliberately narrow. Executioner never sets these, so an inherited value can
 * only mean the app was launched from inside a Claude session — and Claude
 * reads them as proof it is a nested child, which is what silently stops
 * transcript persistence. Everything else Claude Code exports (`CLAUDECODE`,
 * entrypoint, exec path, pid) is left alone: those tell a spawned agent it is
 * running inside another Claude Code, which is true and which it uses to decide
 * what to claim for itself. Stripping them made every agent believe it was a
 * top-level session.
 */
export const CLAUDE_SESSION_MARKERS: readonly string[] = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
]
