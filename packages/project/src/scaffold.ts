import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ScaffoldOptions {
  /** Engagement display name, used in the HUNT.md heading. */
  name: string
  /** Free-form program description, written into HUNT.md. */
  description?: string
  /** Free-form scope paste, written into docs/SCOPE.md. */
  scope?: string
}

export interface ScaffoldResult {
  /** Folder names created (or already present) relative to the root. */
  folders: string[]
  /** File paths written, relative to the root (POSIX separators). */
  files: string[]
}

/**
 * The bug-bounty methodology folders, mirroring the user's `bugbounty-hunt` /
 * `bug-bounty` skills: a working area for recon output, per-vuln writeups,
 * scratch notes, and captured evidence.
 */
const FOLDERS = ['recon', 'vuln', 'notes', 'evidence', 'docs'] as const

function huntTemplate(name: string, description: string | undefined): string {
  const body = description !== undefined && description.trim() !== '' ? description.trim() : '_No program description provided yet._'
  return `# Hunt Log — ${name}

## Program

${body}

## Toolchain

_Record which recon/scanning toolchain was used here._

---

## Phase 1: Recon

## Phase 2: Vulnerability Hunting

## Findings

_One line per confirmed finding; full writeups live in \`vuln/\`._
`
}

function scopeTemplate(name: string, scope: string): string {
  return `# ${name} — Scope

Pasted from the program (HackerOne/Bugcrowd/etc.). Parsed in-scope targets are
tracked in the engagement's target tree.

\`\`\`
${scope.trim()}
\`\`\`
`
}

/**
 * Lay out the bug-bounty methodology structure inside an engagement root that
 * already has its `.executioner/` metadata. Deterministic and idempotent: it
 * creates any missing folders, and writes HUNT.md / docs/SCOPE.md only when they
 * don't already exist (so a user's edits are never clobbered). Pure filesystem
 * work — no agent involved.
 */
export function scaffoldEngagement(root: string, options: ScaffoldOptions): ScaffoldResult {
  const folders: string[] = []
  for (const folder of FOLDERS) {
    mkdirSync(join(root, folder), { recursive: true })
    folders.push(folder)
  }

  const files: string[] = []

  const huntPath = join(root, 'HUNT.md')
  if (!existsSync(huntPath)) {
    writeFileSync(huntPath, huntTemplate(options.name, options.description), 'utf8')
    files.push('HUNT.md')
  }

  if (options.scope !== undefined && options.scope.trim() !== '') {
    const scopePath = join(root, 'docs', 'SCOPE.md')
    if (!existsSync(scopePath)) {
      writeFileSync(scopePath, scopeTemplate(options.name, options.scope), 'utf8')
      files.push('docs/SCOPE.md')
    }
  }

  return { folders, files }
}
