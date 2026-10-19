import { setFlagsFromString } from 'node:v8'
import { describe, expect, it } from 'vitest'
import {
  ConditionError,
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_LENGTH,
  evaluateCondition,
  parseCondition,
} from './condition.js'
import { evaluateIfOutcome } from './control.js'

// What the engine does on import of infra/linear-regex.ts.
setFlagsFromString('--enable-experimental-regexp-engine')

const ev = (expression: string, data: unknown = {}): unknown => evaluateCondition(expression, data)

function errorOf(expression: string, data: unknown = {}): ConditionError {
  try {
    evaluateCondition(expression, data)
  } catch (e) {
    expect(e).toBeInstanceOf(ConditionError)
    return e as ConditionError
  }
  throw new Error(`expected "${expression}" to fail`)
}

describe('condition literals', () => {
  it.each<[string, unknown]>([
    ['42', 42],
    ['3.5', 3.5],
    ['.5', 0.5],
    ['1e3', 1000],
    ['2.5E-1', 0.25],
    ['"double"', 'double'],
    ["'single'", 'single'],
    ['"esc \\" \\\\ \\n \\t \\u0041 \\u{1F600} \\x41"', 'esc " \\ \n \t A \u{1F600} A'],
    ['true', true],
    ['false', false],
    ['null', null],
    ['undefined', undefined],
    ['Infinity', Infinity],
  ])('%s', (src, value) => {
    expect(ev(src)).toEqual(value)
  })

  it('reads NaN', () => {
    expect(Number.isNaN(ev('NaN'))).toBe(true)
  })
})

describe('condition paths into data', () => {
  const data = {
    status: 'open',
    nested: { count: 3, deeper: { ok: true } },
    ports: [80, 443],
    rows: [{ host: 'a.example.com' }],
    'odd key': 'x',
    nil: null,
  }

  it.each<[string, unknown]>([
    ['data', data],
    ['data.status', 'open'],
    ['data.nested.count', 3],
    ['data.nested.deeper.ok', true],
    ['data.ports[0]', 80],
    ['data.ports[1]', 443],
    ['data.ports[2]', undefined],
    ['data.ports.length', 2],
    ['data.rows[0].host', 'a.example.com'],
    ['data["odd key"]', 'x'],
    ["data['status']", 'open'],
    ['data.status.length', 4],
    ['data.status[0]', 'o'],
    ['data.missing', undefined],
    ['data.nil', null],
    ['data.missing?.deep', undefined],
    ['data.missing?.deep.deeper', undefined],
    ['data.nested?.count', 3],
    ['data.ports[1 - 1]', 80],
  ])('%s', (src, value) => {
    expect(ev(src, data)).toEqual(value)
  })

  it('reads only own properties, never inherited ones', () => {
    expect(ev('data.toString', {})).toBeUndefined()
    expect(ev('data.hasOwnProperty', {})).toBeUndefined()
    expect(ev('data.ports.map', { ports: [] })).toBeUndefined()
    // An object with its own prototype chain is not plain data at all.
    expect(errorOf('data.x', Object.create({ x: 1 }) as unknown).message).toContain('cannot read "x" of an object')
  })

  it('never runs a getter', () => {
    let ran = false
    const data = {}
    Object.defineProperty(data, 'x', {
      enumerable: true,
      get() {
        ran = true
        return 1
      },
    })
    expect(ev('data.x', data)).toBeUndefined()
    expect(ran).toBe(false)
  })

  it('fails reading a field of undefined or null, naming the position', () => {
    expect(errorOf('data.missing.deep').message).toBe('cannot read "deep" of undefined at position 14')
    expect(errorOf('data.nil.x', { nil: null }).message).toBe('cannot read "x" of null at position 10')
  })

  it('refuses objects that are not plain data', () => {
    expect(errorOf('data.d.x', { d: new Date() }).message).toContain('cannot read "x" of an object')
  })
})

describe('condition operators', () => {
  it.each<[string, unknown]>([
    ['1 == 1', true],
    ['1 == "1"', true],
    ['null == undefined', true],
    ['0 == ""', true],
    ['1 != 2', true],
    ['1 === 1', true],
    ['1 === "1"', false],
    ['1 !== "1"', true],
    ['1 < 2', true],
    ['2 <= 2', true],
    ['3 > 2', true],
    ['2 >= 3', false],
    ['"a" < "b"', true],
    ['"10" < "9"', true],
    ['"10" < 9', false],
    ['true && false', false],
    ['true || false', true],
    ['0 || "x"', 'x'],
    ['"" && "x"', ''],
    ['null ?? "d"', 'd'],
    ['0 ?? "d"', 0],
    ['!true', false],
    ['!!"x"', true],
    ['-3', -3],
    ['+"4"', 4],
    ['1 + 2', 3],
    ['"a" + 1', 'a1'],
    ['1 + "a"', '1a'],
    ['7 - 2', 5],
    ['3 * 4', 12],
    ['7 / 2', 3.5],
    ['7 % 3', 1],
    ['true ? "y" : "n"', 'y'],
    ['0 ? "y" : "n"', 'n'],
  ])('%s', (src, value) => {
    expect(ev(src)).toEqual(value)
  })

  it.each<[string, unknown]>([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['16 / 4 / 2', 2],
    ['2 * 3 % 4', 2],
    ['-2 * 3', -6],
    ['!false && false', false],
    ['true || false && false', true],
    ['(true || false) && false', false],
    ['1 + 1 === 2', true],
    ['1 < 2 === true', true],
    ['1 < 2 && 3 > 4 || 5 === 5', true],
    ['false ? 1 : true ? 2 : 3', 2],
    ['true ? false ? 1 : 2 : 3', 2],
    ['1 + 2 > 2 ? "big" : "small"', 'big'],
    ['((((1))))', 1],
  ])('precedence: %s', (src, value) => {
    expect(ev(src)).toEqual(value)
  })

  it('short-circuits, so the unevaluated side cannot fail', () => {
    expect(ev('false && data.missing.deep')).toBe(false)
    expect(ev('true || data.missing.deep')).toBe(true)
    expect(ev('data.x ?? data.y', { x: 1 })).toBe(1)
  })

  it('compares objects by identity and coerces them without calling their methods', () => {
    const data = { list: [1, 2], obj: { toString: 'not a function' } }
    expect(ev('data.list === data.list', data)).toBe(true)
    expect(ev('data.list == "1,2"', data)).toBe(true)
    expect(ev('data.obj + ""', data)).toBe('[object Object]')
    expect(ev('String(data.obj)', data)).toBe('[object Object]')
    expect(Number.isNaN(ev('Number(data.obj)', data))).toBe(true)
    expect(ev('data.obj < 1', data)).toBe(false)
  })
})

describe('condition helpers', () => {
  const data = { value: 'Hello World', count: '12', tags: ['a', 'b'], n: 5 }

  it.each<[string, unknown]>([
    ['String(data.n)', '5'],
    ['String(data.missing)', 'undefined'],
    ['String(data.tags)', 'a,b'],
    ['String()', ''],
    ['Number(data.count)', 12],
    ['Number()', 0],
    ['Boolean("")', false],
    ['Boolean(data.value)', true],
    ['data.value.includes("World")', true],
    ['data.value.includes("world")', false],
    ['data.value.includes("Hello", 1)', false],
    ['data.value.startsWith("Hello")', true],
    ['data.value.endsWith("World")', true],
    ['data.value.toLowerCase()', 'hello world'],
    ['data.value.toUpperCase()', 'HELLO WORLD'],
    ['"  x ".trim()', 'x'],
    ['data.tags.includes("b")', true],
    ['data.tags.includes("c")', false],
    ['data.missing?.includes("x")', undefined],
    ['new RegExp("^Hel+o").test(data.value)', true],
    ['new RegExp("^world").test(data.value)', false],
    ['new RegExp("^b$", "m").test("a\\nb")', true],
    ['new RegExp("a.b", "s").test("a\\nb")', true],
    ['new RegExp("[0-9]{2,}").test(data.count)', true],
  ])('%s', (src, value) => {
    expect(ev(src, data)).toEqual(value)
  })

  it('stays linear on a pattern that would backtrack catastrophically', () => {
    const start = Date.now()
    expect(ev('new RegExp("(a+)+$").test(data.s)', { s: `${'a'.repeat(50_000)}b` })).toBe(false)
    expect(ev('new RegExp(".*.*.*x").test(data.s)', { s: 'a'.repeat(50_000) })).toBe(false)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('rejects regex features that need backtracking, with what to write instead', () => {
    expect(errorOf('new RegExp("(?=a)").test("a")').message).toContain('needs backtracking')
    expect(errorOf('new RegExp("(a)\\\\1").test("aa")').message).toContain('needs backtracking')
    expect(errorOf('new RegExp("a", "i").test("A")').message).toContain('.toLowerCase()')
    expect(errorOf('new RegExp("a", "g").test("A")').message).toContain('flag "g" is not supported')
    expect(errorOf('new RegExp("(").test("a")').message).toContain('invalid regex')
    expect(errorOf('new RegExp("a", "mm").test("a")').message).toContain('a regex flag is repeated')
    expect(errorOf(`new RegExp("${'a'.repeat(501)}").test("a")`).message).toContain('longer than 500')
  })

  it('refuses calls outside the allow-list, before anything runs', () => {
    expect(errorOf('data.value.match("x")').message).toContain('"match" is not an allowed function')
    expect(errorOf('data.value.replace("a", "b")').message).toContain('"replace" is not an allowed function')
    expect(errorOf('data.toString()').message).toContain('"toString" is not an allowed function')
    expect(errorOf('data.f()').message).toContain('"f" is not an allowed function')
    expect(errorOf('(data.value)("x")').message).toContain('"value" is not an allowed function')
    expect(errorOf('"x"()').message).toContain('cannot be called')
    expect(errorOf('JSON.parse("1")').message).toContain('unknown name "JSON"')
    expect(errorOf('Math.max(1, 2)').message).toContain('unknown name "Math"')
    expect(errorOf('new Function("x")').message).toContain('only new RegExp')
    expect(errorOf('new Date()').message).toContain('only new RegExp')
    expect(errorOf('String').message).toContain('can only be called')
    expect(errorOf('data.value.includes', { value: 'x' }).message).toContain('can only be called')
  })

  it('refuses a helper called on the wrong kind of value', () => {
    expect(errorOf('data.n.includes(1)', { n: 5 }).message).toContain('"includes" cannot be called on 5')
    expect(errorOf('data.tags.startsWith("a")', { tags: [] }).message).toContain('cannot be called on an array')
    expect(errorOf('data.x.trim()').message).toContain('cannot call "trim" on undefined')
    expect(errorOf('"x".test("x")').message).toContain('"test" cannot be called on a string')
  })
})

/**
 * Every condition found in the codebase: the canvas IF builder's output for each
 * operator (apps/desktop/src/renderer/lib/if-expression.ts), and the conditions
 * the graph, executor and run-diagnostics tests use. No bundled workflow
 * template ships an IF node.
 */
describe('existing conditions', () => {
  it.each<[string, unknown, boolean]>([
    // IF builder output, one per operator.
    ['data.value === "x"', { value: 'x' }, true],
    ['data.value === "x"', { value: 'y' }, false],
    ['data.value !== "x"', { value: 'y' }, true],
    ['String(data.value).includes("x")', { value: 'axb' }, true],
    ['String(data.value).includes("x")', { value: 'ab' }, false],
    ['String(data.value).includes("1")', { value: 123 }, true],
    ['!String(data.value).includes("x")', { value: 'ab' }, true],
    ['String(data.value).startsWith("x")', { value: 'xy' }, true],
    ['String(data.value).endsWith("x")', { value: 'yx' }, true],
    ['(data.value === undefined || data.value === "" || data.value === null)', {}, true],
    ['(data.value === undefined || data.value === "" || data.value === null)', { value: '' }, true],
    ['(data.value === undefined || data.value === "" || data.value === null)', { value: null }, true],
    ['(data.value === undefined || data.value === "" || data.value === null)', { value: 0 }, false],
    ['(data.value !== undefined && data.value !== "" && data.value !== null)', { value: 'a' }, true],
    ['(data.value !== undefined && data.value !== "" && data.value !== null)', {}, false],
    ['Number(data.count) > Number("3")', { count: '4' }, true],
    ['Number(data.count) > Number("3")', { count: 3 }, false],
    ['Number(data.count) < Number("3")', { count: 2 }, true],
    ['Number(data.count) >= Number("3")', { count: '3' }, true],
    ['Number(data.count) <= Number("3")', { count: 'x' }, false],
    ['new RegExp("^a").test(String(data.value))', { value: 'abc' }, true],
    ['new RegExp("^a").test(String(data.value))', { value: 'bac' }, false],
    ['Number(data.count) > Number("3") && data.status === "open"', { count: 5, status: 'open' }, true],
    ['Number(data.count) > Number("3") && data.status === "open"', { count: 5, status: 'closed' }, false],
    ['data.value === "a" || data.value === "b"', { value: 'b' }, true],
    ['data.value === "a\\"b"', { value: 'a"b' }, true],
    ['false', {}, false],
    // Engine and graph tests.
    ['true', {}, true],
    ['data.count > 0', { count: 5 }, true],
    ['data.count > 0', { count: 0 }, false],
    ['data.status === "open"', { status: 'open' }, true],
    ['data.alive', { alive: true }, true],
    ['data.alive', { alive: false }, false],
    ['data.alive === false', { alive: true }, false],
  ])('%s with %j', (src, data, branch) => {
    expect(evaluateIfOutcome(src, data)).toEqual({ branch: branch ? 'true' : 'false' })
  })

  it('still reports the conditions that failed before', () => {
    expect(evaluateIfOutcome('data.missing.deep', {}).error).toBe('cannot read "deep" of undefined at position 14')
    expect(evaluateIfOutcome('nonsense.that.throws', {}).error).toContain('unknown name "nonsense"')
    expect(evaluateIfOutcome('this is not javascript', {}).error).toContain('"this" is not available')
    expect(evaluateIfOutcome('{{ nodes.probe.alive }}', {}).error).toContain('object literals are not supported')
  })
})

describe('condition rejections', () => {
  it.each<[string, string]>([
    ['data.__proto__', '"__proto__" cannot be read'],
    ['data.constructor', '"constructor" cannot be read'],
    ['data.prototype', '"prototype" cannot be read'],
    ['data["__proto__"]', '"__proto__" cannot be read'],
    ['data["con" + "structor"]', '"constructor" cannot be read'],
    ['data.value.constructor.constructor("return process")()', '"constructor" cannot be read'],
    ['data[["__proto__"]]', 'unexpected "["'],
    ['data[data]', 'a property key must be a string or a number'],
    ['data.x = 1', 'assignment is not allowed; use === to compare'],
    ['data.x += 1', 'assignment is not allowed'],
    ['data.x++', 'increment and decrement are not allowed'],
    ['this', '"this" is not available'],
    ['this.constructor', '"this" is not available'],
    ['globalThis', 'unknown name "globalThis"'],
    ['constructor', 'unknown name "constructor"'],
    ['toString', 'unknown name "toString"'],
    ['process.exit()', 'unknown name "process"'],
    ['require("fs")', 'unknown name "require"'],
    ['eval("1")', 'unknown name "eval"'],
    ['Function("x")', 'unknown name "Function"'],
    ['import("fs")', 'import is not allowed'],
    ['`x`', 'template literals are not supported; join strings with +'],
    ['`${process}`', 'template literals are not supported'],
    ['1, 2', 'a comma is only allowed between call arguments'],
    ['(1, process)', 'a comma is only allowed between call arguments'],
    ['data[0, "x"]', 'a comma is only allowed between call arguments'],
    ['true; process', 'a condition is a single expression'],
    ['() => 1', 'functions cannot be defined in a condition'],
    ['x => 1', 'functions cannot be defined in a condition'],
    ['({}).x', 'object literals are not supported'],
    ['[1, 2]', 'unexpected "["'],
    ['/abc/.test(data.x)', 'regex literals are not supported; write new RegExp("...").test(...)'],
    ['typeof data.x === "string"', 'typeof is not supported'],
    ['"a" in data', 'the in operator is not supported'],
    ['data instanceof Object', 'instanceof is not supported'],
    ['delete data.x', 'delete is not allowed'],
    ['1 & 1', 'bitwise operators are not supported; use && or ||'],
    ['2 ** 2', 'the ** operator is not supported'],
    ['data?.[0]', 'only ?. followed by a name is supported'],
    ['data.x?.()', 'only ?. followed by a name is supported'],
    ['RegExp("a")', 'write new RegExp(...)'],
    ['"unterminated', 'unterminated string'],
    ['1 +', 'the condition ends too early'],
    ['(1', 'expected ")" but found the end of the condition'],
    ['1 2', 'unexpected "2"'],
    ['12abc', 'invalid number'],
    ['#', 'unexpected character "#"'],
    ['"\\u12"', 'invalid unicode escape'],
  ])('%s', (src, message) => {
    expect(errorOf(src).message).toContain(message)
  })

  it('names the position of the failure, 1-based', () => {
    const e = errorOf('data.ok && process')
    expect(e.position).toBe(12)
    expect(e.message).toBe('unknown name "process"; a condition can only read data at position 12')
  })

  it('keeps positions relative to the condition as written, leading space included', () => {
    expect(evaluateIfOutcome('  bogus', {}).error).toContain('at position 3')
  })
})

describe('condition limits', () => {
  it('accepts a condition at the length cap and refuses one past it', () => {
    const atCap = `1${' '.repeat(MAX_CONDITION_LENGTH - 1)}`
    expect(ev(atCap)).toBe(1)
    expect(errorOf(`${atCap} `).message).toContain(`longer than ${MAX_CONDITION_LENGTH} characters`)
  })

  it('accepts nesting at the depth cap and refuses one level more', () => {
    // The whole condition is one level, and each parenthesis adds another.
    const ok = `${'('.repeat(MAX_CONDITION_DEPTH - 1)}1${')'.repeat(MAX_CONDITION_DEPTH - 1)}`
    expect(ev(ok)).toBe(1)
    const deep = `${'('.repeat(MAX_CONDITION_DEPTH)}1${')'.repeat(MAX_CONDITION_DEPTH)}`
    expect(errorOf(deep).message).toContain(`deeper than ${MAX_CONDITION_DEPTH} levels`)
    expect(errorOf(`${'!'.repeat(MAX_CONDITION_DEPTH + 1)}1`).message).toContain('deeper than')
    expect(errorOf(`${'1 ? '.repeat(MAX_CONDITION_DEPTH)}1${' : 1'.repeat(MAX_CONDITION_DEPTH)}`).message).toContain(
      'deeper than',
    )
  })

  it('refuses to build an oversized string', () => {
    const big = 'x'.repeat(600_000)
    expect(errorOf('data.s + data.s', { s: big }).message).toContain('longer than 1000000 characters')
  })

  it('parses a long flat chain without nesting limits getting in the way', () => {
    expect(ev(Array.from({ length: 300 }, () => '1').join(' + '))).toBe(300)
    expect(ev(`data${'?.a'.repeat(300)}`, {})).toBeUndefined()
  })

  it('parses without evaluating', () => {
    expect(() => parseCondition('data.missing.deep')).not.toThrow()
    expect(() => parseCondition('process')).toThrow(ConditionError)
  })
})

describe('hostile conditions', () => {
  const hostile = [
    'constructor.constructor("return process")()',
    'data.constructor.constructor("return process")().exit()',
    '"".constructor.constructor("return this")()',
    '[].constructor.constructor("return process")()',
    'data.__proto__.polluted = 1',
    'Object.prototype.polluted = 1',
    'data["__pro" + "to__"]',
    'data[`__proto__`]',
    'String.constructor',
    'Number.prototype',
    'new RegExp("a").constructor',
    'new RegExp("a").exec("a")',
    'new RegExp("a")["test"]("a")',
    'data.value["includes"]("x")',
    'new RegExp("a").test.call(null, "a")',
    '(0, eval)("1")',
    'globalThis.process.mainModule.require("child_process")',
    'import.meta',
    'this.constructor.constructor("return process")()',
    'arguments',
    'new.target',
    'super.x',
    'async () => 1',
    'function () { return 1 }',
    'class A {}',
    'let x = 1',
    '/(a+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab")',
    'new RegExp("(a+)+$").test("' + 'a'.repeat(5000) + 'b")',
    '"\\u{110000}"',
    '"\\x4"',
    ' ',
    '" "',
    '\0',
    '"a\\',
    'data.a?.b?.c?.d?.e',
    '1..toString()',
    '1.e',
    '0x10',
    '1_000',
    '<!-- comment -->',
    '// comment',
    '/* comment */ 1',
    '?.',
    '?.5',
    'true?.5:1',
    ')',
    ']',
    '(',
    '[',
    '.',
    '...data',
    '"x"[0]()',
    'data[data]',
    'data[undefined]',
    'data[null]',
    'data[true]',
    'data[1.5]',
    'data[-1]',
    'String(String)',
    'Number(new RegExp("a"))',
    '!' + '('.repeat(500),
    ')'.repeat(500),
    '"'.repeat(1999),
    '\\'.repeat(100),
    'a'.repeat(1999),
    'data' + '[0]'.repeat(400),
    'data' + '?.x'.repeat(400),
    '-'.repeat(1000) + '1',
    '- '.repeat(999) + '1',
  ]

  // Deterministic pseudo-random strings built from the language's own pieces.
  const pieces = [
    'data', '.', '?.', '[', ']', '(', ')', '"x"', "'y'", '1', '0', '-', '+', '*', '/', '%', '!', '&&', '||',
    '??', '?', ':', '===', '!==', '==', '!=', '<', '>=', 'true', 'null', 'undefined', 'String', 'Number',
    'Boolean', 'new', 'RegExp', '.test', '.includes', '.length', ',', '__proto__', 'constructor', '`', '\\',
    ' ', 'process', 'this', '=', ';', '{', '}',
  ]
  let seed = 0x2545f491
  const rand = (n: number): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) % n
  }
  for (let i = 0; i < 2000; i++) {
    const len = 1 + rand(16)
    let s = ''
    for (let j = 0; j < len; j++) s += pieces[rand(pieces.length)]!
    hostile.push(s)
  }

  it('throws nothing but ConditionError, and never hangs', () => {
    const data = { value: 'x', a: { b: null }, list: [1, 'two', { three: 3 }] }
    const before = (Object.prototype as Record<string, unknown>).polluted
    const start = Date.now()
    for (const src of hostile) {
      try {
        evaluateCondition(src, data)
      } catch (e) {
        if (!(e instanceof ConditionError)) throw new Error(`"${src}" threw ${String(e)}`, { cause: e })
      }
      const outcome = evaluateIfOutcome(src, data)
      expect(['true', 'false']).toContain(outcome.branch)
    }
    expect(Date.now() - start).toBeLessThan(5000)
    expect((Object.prototype as Record<string, unknown>).polluted).toBe(before)
  })
})
