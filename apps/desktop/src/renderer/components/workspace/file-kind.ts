/**
 * Pure predicates describing what kind of content a file holds.
 *
 * Kept apart from the editor components so tests (and any caller that only
 * needs the classification) can import them without pulling Monaco — and its
 * web workers — into the module graph.
 */

/** A file is treated as markdown (rendered) when it carries a markdown extension. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * A NUL byte (or a run of Unicode replacement chars from a failed utf-8 decode)
 * means the engine handed us bytes that aren't text — show a placeholder rather
 * than dumping mojibake into the viewer.
 */
export function looksBinary(content: string): boolean {
  if (content.includes('\u0000')) return true
  const sample = content.slice(0, 4096)
  if (sample.length === 0) return false
  let replacements = 0
  for (const ch of sample) if (ch === '\uFFFD') replacements += 1
  return replacements / sample.length > 0.1
}
