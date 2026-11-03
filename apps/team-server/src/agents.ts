import { execFile } from 'node:child_process'

/** Agent CLIs the onboarding flow probes for (same set as desktop main). */
export const AGENT_BINARIES: { id: string; binary: string }[] = [
  { id: 'claude', binary: 'claude' },
  { id: 'codex', binary: 'codex' },
  { id: 'opencode', binary: 'opencode' },
  { id: 'gemini', binary: 'gemini' },
  { id: 'cursor', binary: 'cursor-agent' },
  { id: 'hermes', binary: 'hermes' },
]

export interface AgentAvailability {
  id: string
  installed: boolean
}

/**
 * Resolve whether an agent CLI is on PATH. Uses a login shell so nvm /
 * Homebrew / ~/.local/bin match what the operator's terminal sees.
 */
export function probeAgent(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        execFile('where', [binary], { windowsHide: true, timeout: 5000 }, (err) => resolve(err === null))
      } else {
        const shell = process.env.SHELL ?? '/bin/bash'
        // binary is only from AGENT_BINARIES (fixed allowlist), never user input.
        execFile(shell, ['-lc', `command -v ${binary}`], { timeout: 5000 }, (err, stdout) =>
          resolve(err === null && stdout.trim() !== ''),
        )
      }
    } catch {
      resolve(false)
    }
  })
}

export async function checkAgents(): Promise<AgentAvailability[]> {
  return Promise.all(
    AGENT_BINARIES.map(async ({ id, binary }) => ({
      id,
      installed: await probeAgent(binary).catch(() => false),
    })),
  )
}
