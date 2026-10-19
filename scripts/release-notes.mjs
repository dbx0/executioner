#!/usr/bin/env node
/**
 * Print Markdown release notes for a tag, built from the Conventional Commit
 * subjects between the previous v* tag and this one (the whole history for the
 * first release).
 *
 * Usage: node scripts/release-notes.mjs v0.0.1 > notes.md
 */
import { execFileSync } from 'node:child_process'

const tag = process.argv[2]
if (!tag) {
  console.error('usage: release-notes.mjs <tag>')
  process.exit(2)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

// A tag on the root commit has no parent to look behind, so it is the first release.
const hasParent = git('rev-list', '--parents', '-n', '1', tag).split(' ').length > 1
const previous = hasParent ? (git('tag', '--list', 'v*', '--sort=-v:refname', '--merged', `${tag}^`).split('\n')[0] ?? '') : ''
const range = previous === '' ? tag : `${previous}..${tag}`
const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean)

const sections = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['style', 'Style'],
  ['docs', 'Documentation'],
  ['build', 'Build'],
  ['ci', 'CI'],
  ['test', 'Tests'],
  ['chore', 'Chores'],
]
const header = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/
const grouped = new Map()
const breaking = []
const other = []

for (const subject of subjects) {
  const match = header.exec(subject)
  if (match === null) {
    other.push(subject)
    continue
  }
  const [, type, scope, bang, text] = match
  const line = scope ? `**${scope}:** ${text}` : text
  if (bang) breaking.push(line)
  if (!sections.some(([t]) => t === type)) {
    other.push(subject)
    continue
  }
  grouped.set(type, [...(grouped.get(type) ?? []), line])
}

const out = []
if (breaking.length > 0) out.push('### Breaking changes', '', ...breaking.map((l) => `- ${l}`), '')
for (const [type, title] of sections) {
  const lines = grouped.get(type)
  if (lines === undefined) continue
  out.push(`### ${title}`, '', ...lines.map((l) => `- ${l}`), '')
}
if (other.length > 0) out.push('### Other', '', ...other.map((l) => `- ${l}`), '')
out.push(previous === '' ? `First release (${subjects.length} commits).` : `Changes since ${previous}.`)

process.stdout.write(`${out.join('\n')}\n`)
