/**
 * A content fingerprint used as the authority for "did disk change under us".
 *
 * Two independent FNV lanes plus the length, rather than one 32-bit lane: a
 * collision here is a *missed conflict* — the editor would overwrite an
 * external write without warning — so the extra lane is cheap insurance
 * against the one failure mode that loses user work.
 */
export function getDiskBaselineSignature(content: string): string {
  let hashA = 2166136261
  let hashB = 84696351
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i)
    hashA ^= code
    hashA = Math.imul(hashA, 16777619)
    hashB = Math.imul(hashB ^ code, 1099511627)
  }
  return `${(hashA >>> 0).toString(16)}-${(hashB >>> 0).toString(16)}-${content.length.toString(16)}`
}
