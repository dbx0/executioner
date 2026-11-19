/** The last segment of a path, for either separator. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? path
}

/** The wrappers a failure picks up on its way from the engine to the screen. */
const WRAPPERS = [
  /^Error invoking remote method '[^']*':\s*/,
  /^(?:Uncaught\s+)?Error:\s*/i,
  /^engine exited before handshake \(code [^)]*\):?\s*/i,
  /^error:\s*/i,
]

/** Peel every transport prefix off a message, leaving what actually went wrong. */
function unwrap(message: string): string {
  let text = message.trim()
  for (let changed = true; changed; ) {
    changed = false
    for (const wrapper of WRAPPERS) {
      const next = text.replace(wrapper, '')
      if (next !== text) {
        text = next
        changed = true
      }
    }
  }
  return text
}

/**
 * What to tell the operator when an engagement folder would not open.
 *
 * The raw failure arrives wrapped three deep (the IPC call, the engine process
 * exiting, the engine's own error line), which reads as a crash when the cause
 * is usually ordinary: the folder was never set up as an engagement. This keeps
 * the cause, drops the plumbing, and says what to do next. Pass `dir` when
 * several folders are opening at once, so the message names the one that failed.
 */
export function engagementOpenError(error: unknown, dir?: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const cause = unwrap(raw)
  const what = dir === undefined ? 'the engagement' : `"${folderName(dir)}"`

  const notProject = /^(.+?) is not an Executioner project\.?$/.exec(cause)
  if (notProject !== null) {
    return `"${folderName(notProject[1]!)}" is not an engagement yet. Create one in that folder with New engagement, or open a folder that already has one.`
  }
  if (cause === '') {
    return /engine exited before handshake/i.test(raw)
      ? `The engine could not start for ${what}. Try again, and restart the app if it keeps failing.`
      : `Could not open ${what}.`
  }
  return `Could not open ${what}: ${cause}`
}
