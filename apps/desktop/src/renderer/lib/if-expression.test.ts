import { setFlagsFromString } from 'node:v8'
import { describe, expect, it } from 'vitest'
import { evaluateIfOutcome } from '@exe/graph'
import { parseIf, serializeIf, type IfModel, type IfOperator } from './if-expression.js'

// The engine turns on V8's linear-time regex engine, which regex conditions need.
setFlagsFromString('--enable-experimental-regexp-engine')

function model(partial: Partial<IfModel>): IfModel {
  return { conditions: [], combinator: 'and', ...partial }
}

describe('serializeIf', () => {
  it('serializes each operator to the expected JS', () => {
    const f = 'value'
    expect(serializeIf(model({ conditions: [{ field: f, operator: 'eq', value: 'x' }] }))).toBe(
      'data.value === "x"',
    )
    expect(serializeIf(model({ conditions: [{ field: f, operator: 'neq', value: 'x' }] }))).toBe(
      'data.value !== "x"',
    )
    expect(serializeIf(model({ conditions: [{ field: f, operator: 'contains', value: 'x' }] }))).toBe(
      'String(data.value).includes("x")',
    )
    expect(
      serializeIf(model({ conditions: [{ field: f, operator: 'not_contains', value: 'x' }] })),
    ).toBe('!String(data.value).includes("x")')
    expect(
      serializeIf(model({ conditions: [{ field: f, operator: 'starts_with', value: 'x' }] })),
    ).toBe('String(data.value).startsWith("x")')
    expect(
      serializeIf(model({ conditions: [{ field: f, operator: 'ends_with', value: 'x' }] })),
    ).toBe('String(data.value).endsWith("x")')
    expect(serializeIf(model({ conditions: [{ field: f, operator: 'is_empty', value: '' }] }))).toBe(
      '(data.value === undefined || data.value === "" || data.value === null)',
    )
    expect(
      serializeIf(model({ conditions: [{ field: f, operator: 'is_not_empty', value: '' }] })),
    ).toBe('(data.value !== undefined && data.value !== "" && data.value !== null)')
    expect(serializeIf(model({ conditions: [{ field: 'count', operator: 'gt', value: '3' }] }))).toBe(
      'Number(data.count) > Number("3")',
    )
    expect(serializeIf(model({ conditions: [{ field: 'count', operator: 'lt', value: '3' }] }))).toBe(
      'Number(data.count) < Number("3")',
    )
    expect(
      serializeIf(model({ conditions: [{ field: 'count', operator: 'gte', value: '3' }] })),
    ).toBe('Number(data.count) >= Number("3")')
    expect(
      serializeIf(model({ conditions: [{ field: 'count', operator: 'lte', value: '3' }] })),
    ).toBe('Number(data.count) <= Number("3")')
    expect(
      serializeIf(model({ conditions: [{ field: f, operator: 'regex', value: '^a' }] })),
    ).toBe('new RegExp("^a").test(String(data.value))')
  })

  it('joins a two-condition AND with &&', () => {
    expect(
      serializeIf(
        model({
          combinator: 'and',
          conditions: [
            { field: 'count', operator: 'gt', value: '3' },
            { field: 'status', operator: 'eq', value: 'open' },
          ],
        }),
      ),
    ).toBe('Number(data.count) > Number("3") && data.status === "open"')
  })

  it('joins an OR with ||', () => {
    expect(
      serializeIf(
        model({
          combinator: 'or',
          conditions: [
            { field: 'value', operator: 'eq', value: 'a' },
            { field: 'value', operator: 'eq', value: 'b' },
          ],
        }),
      ),
    ).toBe('data.value === "a" || data.value === "b"')
  })

  it('serializes an empty conditions list to "false"', () => {
    expect(serializeIf(model({ conditions: [] }))).toBe('false')
  })

  it('escapes values containing quotes', () => {
    expect(
      serializeIf(model({ conditions: [{ field: 'value', operator: 'eq', value: 'a"b' }] })),
    ).toBe('data.value === "a\\"b"')
  })

  it('falls back to data.value when field is empty', () => {
    expect(
      serializeIf(model({ conditions: [{ field: '', operator: 'contains', value: 'x' }] })),
    ).toBe('String(data.value).includes("x")')
  })
})

describe('parseIf', () => {
  it('returns a default model for undefined', () => {
    expect(parseIf(undefined)).toEqual({
      conditions: [{ field: 'value', operator: 'contains', value: '' }],
      combinator: 'and',
    })
  })

  it('returns a default model for an empty string', () => {
    expect(parseIf('')).toEqual({
      conditions: [{ field: 'value', operator: 'contains', value: '' }],
      combinator: 'and',
    })
  })

  it('does not throw on a round-trip of a simple serialized output', () => {
    const source = model({
      combinator: 'and',
      conditions: [
        { field: 'count', operator: 'gt', value: '3' },
        { field: 'status', operator: 'eq', value: 'open' },
      ],
    })
    const expr = serializeIf(source)
    expect(() => parseIf(expr)).not.toThrow()
    expect(parseIf(expr)).toEqual(source)
  })

  it('round-trips an OR combinator', () => {
    const source = model({
      combinator: 'or',
      conditions: [
        { field: 'value', operator: 'eq', value: 'a' },
        { field: 'value', operator: 'is_empty', value: '' },
      ],
    })
    expect(parseIf(serializeIf(source))).toEqual(source)
  })

  it('falls back to default on an unknown shape without throwing', () => {
    expect(() => parseIf('somethingWeird(42)')).not.toThrow()
    expect(parseIf('somethingWeird(42)')).toEqual({
      conditions: [{ field: 'value', operator: 'contains', value: '' }],
      combinator: 'and',
    })
  })
})

describe('serialized conditions in the engine', () => {
  // Every operator the builder offers must stay inside the engine's condition language.
  it.each<[IfOperator, string, Record<string, unknown>, 'true' | 'false']>([
    ['eq', 'open', { value: 'open' }, 'true'],
    ['neq', 'open', { value: 'open' }, 'false'],
    ['contains', 'ell', { value: 'hello' }, 'true'],
    ['not_contains', 'ell', { value: 'hello' }, 'false'],
    ['starts_with', 'he', { value: 'hello' }, 'true'],
    ['ends_with', 'lo', { value: 'hello' }, 'true'],
    ['is_empty', '', { value: '' }, 'true'],
    ['is_not_empty', '', {}, 'false'],
    ['gt', '3', { value: '4' }, 'true'],
    ['lt', '3', { value: 4 }, 'false'],
    ['gte', '3', { value: 3 }, 'true'],
    ['lte', '3', { value: 2 }, 'true'],
    ['regex', '^h.l+o$', { value: 'hello' }, 'true'],
    ['eq', 'a"b\\c', { value: 'a"b\\c' }, 'true'],
  ])('%s %j', (operator, value, data, branch) => {
    const expression = serializeIf(model({ conditions: [{ field: 'value', operator, value }] }))
    expect(evaluateIfOutcome(expression, data)).toEqual({ branch })
  })

  it('evaluates a combined condition', () => {
    const expression = serializeIf(
      model({
        combinator: 'or',
        conditions: [
          { field: 'count', operator: 'gt', value: '10' },
          { field: 'status', operator: 'eq', value: 'open' },
        ],
      }),
    )
    expect(evaluateIfOutcome(expression, { count: 1, status: 'open' })).toEqual({ branch: 'true' })
    expect(evaluateIfOutcome(expression, { count: 1, status: 'closed' })).toEqual({ branch: 'false' })
  })
})
