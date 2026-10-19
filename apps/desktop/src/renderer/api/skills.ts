import type { AxiosInstance } from 'axios'

/** The persisted skills config (mirrors the engine's skills.json). */
export interface SkillsConfig {
  folder: string | null
  enabled: Record<string, boolean>
}

/** A discovered + parsed skill. `path` is the skill directory. */
export interface Skill {
  name: string
  description: string
  path: string
}

/** Result of a POST /skills/agents-md. */
export interface AgentsMdResult {
  ok: boolean
  path: string
  count: number
}

export const skillsApi = (client: AxiosInstance) => ({
  /** The persisted skills config (folder + per-agent enabled flags). */
  getConfig: () => client.get<SkillsConfig>('/skills/config').then((r) => r.data),
  /** Persist the whole skills config. */
  setConfig: (config: SkillsConfig) => client.put<SkillsConfig>('/skills/config', config).then((r) => r.data),
  /** Discover + parse skills in the configured (or an override) folder. */
  list: (folder?: string) =>
    client
      .get<Skill[]>('/skills', folder !== undefined ? { params: { folder } } : undefined)
      .then((r) => r.data),
  /** (Re)generate AGENTS.md from the discovered skills. */
  generateAgentsMd: () => client.post<AgentsMdResult>('/skills/agents-md').then((r) => r.data),
})
