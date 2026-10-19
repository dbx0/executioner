import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The placeholder `scaffoldEngagement` writes when no description was given. */
export const DESCRIPTION_PLACEHOLDER = '_No program description provided yet._'

const HEADING = /^##\s+Program\s*$/i
/**
 * Only a top-level heading closes the section. Anything deeper is the brief's
 * own structure, which is why `writeProgramDescription` demotes the headings it
 * is handed: a brief that arrived with its own `## Rules` would otherwise cut
 * the section in half, and the half below it would be orphaned by the next write.
 */
const BOUNDARY = /^#{1,2}\s/

function huntPath(root: string): string {
  return join(root, 'HUNT.md')
}

/** A fence opens or closes; `#` inside one is a shell comment, not a heading. */
const FENCE = /^\s*(```|~~~)/

/**
 * The line range holding the `## Program` body, or null when there is no such
 * section. Shared by the reader and the writer so they can never disagree about
 * where the section ends, and fence-aware so a code block inside the brief
 * cannot close it.
 */
function programSpan(lines: string[]): { start: number; end: number } | null {
  let fenced = false
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (start === -1) {
      if (HEADING.test(line.trim())) start = i + 1
    } else if (BOUNDARY.test(line)) {
      return { start, end: i }
    }
  }
  return start === -1 ? null : { start, end: lines.length }
}

/**
 * The engagement's own words about the program: the body of `## Program` in
 * HUNT.md, which is where the New-engagement flow puts the description. Read
 * from the file rather than mirrored into config.json so the file stays the one
 * copy an operator can edit by hand. The scaffold's placeholder reads as empty.
 */
export function readProgramDescription(root: string): string {
  const path = huntPath(root)
  if (!existsSync(path)) return ''
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  const lines = text.split('\n')
  const span = programSpan(lines)
  if (span === null) return ''
  const body = lines.slice(span.start, span.end).join('\n').trim()
  return body === DESCRIPTION_PLACEHOLDER ? '' : body
}

/** Push `#`/`##` headings down to `###` so the brief's own structure can never
 *  be mistaken for the end of the section it lives in. Fenced code is left
 *  alone: a `#` there is a shell comment, not a heading. */
function demoteHeadings(markdown: string): string {
  let fenced = false
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced
        return line
      }
      return fenced ? line : line.replace(/^(#{1,2})(\s)/, '###$2')
    })
    .join('\n')
}

/**
 * Replace the `## Program` body, leaving the rest of HUNT.md untouched — the
 * phases, the toolchain notes and anything the operator has written since.
 * Creates the section, or the file, when either is missing.
 *
 * Returns the path written, so a caller can say which file changed.
 */
export function writeProgramDescription(root: string, markdown: string): string {
  const path = huntPath(root)
  const body = demoteHeadings(markdown).trim()

  if (!existsSync(path)) {
    writeFileSync(path, `## Program\n\n${body}\n`, 'utf8')
    return path
  }

  const lines = readFileSync(path, 'utf8').split('\n')
  const span = programSpan(lines)
  if (span === null) {
    const tail = lines[lines.length - 1] === '' ? '' : '\n'
    writeFileSync(path, `${lines.join('\n')}${tail}\n## Program\n\n${body}\n`, 'utf8')
    return path
  }

  lines.splice(span.start, span.end - span.start, '', body, '')
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}
