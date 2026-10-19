import { z } from 'zod'

/** Sentinel prefix so a supervisor can find the handshake among other stdout output. */
export const HANDSHAKE_PREFIX = 'EXECUTIONER_READY '

export const handshakeSchema = z.object({
  port: z.number().int().positive(),
  token: z.string().min(32),
  pid: z.number().int().positive(),
  projectRoot: z.string().min(1),
  version: z.string().min(1),
})

export type Handshake = z.infer<typeof handshakeSchema>

export function formatHandshake(handshake: Handshake): string {
  return HANDSHAKE_PREFIX + JSON.stringify(handshake)
}

export function parseHandshake(line: string): Handshake | undefined {
  if (!line.startsWith(HANDSHAKE_PREFIX)) return undefined
  try {
    return handshakeSchema.parse(JSON.parse(line.slice(HANDSHAKE_PREFIX.length)))
  } catch {
    return undefined
  }
}
