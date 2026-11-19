/**
 * Whether the window runs on macOS, where the native traffic lights float over
 * the top-left corner and the app draws no window controls of its own. Reads
 * the preload bridge defensively: tests and older preloads may not define it.
 */
export function isDarwin(): boolean {
  return (window.executioner as Partial<Window['executioner']> | undefined)?.platform === 'darwin'
}
