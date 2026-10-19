// Trimmed to the extensions we ship.

function extname(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (lastDot <= lastSep) {
    return ''
  }
  return filePath.slice(lastDot).toLowerCase()
}

function basename(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return filePath.slice(lastSep + 1)
}

// Monaco's registry maps .tsx/.cts/.mts onto 'typescript' and .jsx/.mjs/.cjs
// onto 'javascript' — there is no separate 'typescriptreact' id. Returning the
// base id is what gives those files syntax highlighting at all.
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.ini': 'ini',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.graphql': 'graphql',
  '.proto': 'proto',
}

const NAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'docker-compose.yml': 'yaml',
}

/** The Monaco language id for a path, or 'plaintext' when nothing matches. */
export function detectLanguage(filePath: string): string {
  const ext = extname(filePath)
  if (ext !== '') {
    return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
  }
  return NAME_TO_LANGUAGE[basename(filePath).toLowerCase()] ?? 'plaintext'
}
