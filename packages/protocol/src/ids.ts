import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()

export const isoNow = (): string => new Date().toISOString()
