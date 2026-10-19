import axios, { type AxiosInstance } from 'axios'

export interface EngineConnection {
  port: number
  token: string
  projectRoot: string
}

export function createClient(connection: EngineConnection): AxiosInstance {
  return axios.create({
    baseURL: `http://127.0.0.1:${connection.port}/api`,
    headers: { common: { Authorization: `Bearer ${connection.token}` } },
  })
}

export function eventsUrl(connection: EngineConnection): string {
  return `ws://127.0.0.1:${connection.port}/events?token=${connection.token}`
}
