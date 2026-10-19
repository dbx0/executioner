import { describe, expect, it } from 'vitest'
import type { NodeOutputRow } from '../../api/executions.js'
import { mergeNodeRows, type LogFrame } from './merge.js'

const persistedRow = (over: Partial<NodeOutputRow>): NodeOutputRow => ({
  nodeId: 'nmap',
  status: 'succeeded',
  exitCode: 0,
  stdout: '',
  stderr: '',
  parsed: null,
  ...over,
})

const frame = (nodeId: string, data: string, type = 'stdout'): LogFrame => ({ nodeId, type, data })

describe('mergeNodeRows', () => {
  it('marks a finished node by its done event, not as still running', () => {
    // The engine publishes 'done' before writing the row, so a refetch fired by
    // that event finds nothing — the node must not read as running.
    const rows = mergeNodeRows([], [frame('nmap', 'PORT 443 open')], new Map([['nmap', 'succeeded']]))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('succeeded')
    expect(rows[0]?.stdout).toBe('PORT 443 open')
  })

  it('leaves a node with no done event as running', () => {
    const rows = mergeNodeRows([], [frame('nmap', 'starting…')], new Map())
    expect(rows[0]?.status).toBe('running')
  })

  it('carries a failure status through from the bus', () => {
    const rows = mergeNodeRows([], [frame('katana', 'boom', 'stderr')], new Map([['katana', 'failed']]))
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.stderr).toBe('boom')
  })

  it('prefers persisted evidence over the stream, so output is not doubled', () => {
    const rows = mergeNodeRows(
      [persistedRow({ nodeId: 'nmap', stdout: 'PORT 443 open' })],
      [frame('nmap', 'PORT 443 open')],
      new Map([['nmap', 'succeeded']]),
    )
    expect(rows[0]?.stdout).toBe('PORT 443 open')
  })

  it('keeps the persisted status rather than overwriting it from the bus', () => {
    const rows = mergeNodeRows(
      [persistedRow({ nodeId: 'nmap', status: 'failed', exitCode: 2, stdout: 'x' })],
      [],
      new Map([['nmap', 'succeeded']]),
    )
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.exitCode).toBe(2)
  })

  it('settles a persisted row that is still marked running once its done lands', () => {
    const rows = mergeNodeRows(
      [persistedRow({ nodeId: 'nmap', status: 'running' })],
      [],
      new Map([['nmap', 'succeeded']]),
    )
    expect(rows[0]?.status).toBe('succeeded')
  })

  it('appends streamed frames in order for a node with no evidence yet', () => {
    const rows = mergeNodeRows(
      [],
      [frame('gau', 'a\n'), frame('gau', 'b\n'), frame('gau', 'warn', 'stderr')],
      new Map(),
    )
    expect(rows[0]?.stdout).toBe('a\nb\n')
    expect(rows[0]?.stderr).toBe('warn')
  })

  it('shows a node that has only been announced, with no output yet', () => {
    // A silent tool (katana -silent) streams nothing for minutes; without this
    // the run looked idle while it worked.
    const rows = mergeNodeRows([], [], new Map([['sub_katana', 'running']]))
    expect(rows).toEqual([
      { nodeId: 'sub_katana', status: 'running', exitCode: null, stdout: '', stderr: '', parsed: null },
    ])
  })

  it('keeps every persisted node, including ones that produced nothing', () => {
    const rows = mergeNodeRows(
      [persistedRow({ nodeId: 'whois', stdout: 'ok' }), persistedRow({ nodeId: 'nmap', status: 'failed', exitCode: null })],
      [],
      new Map(),
    )
    expect(rows.map((r) => r.nodeId)).toEqual(['whois', 'nmap'])
  })
})
