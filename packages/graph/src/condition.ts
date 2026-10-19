/**
 * The IF node's condition language: a small JavaScript-shaped expression
 * language, tokenized, parsed and walked by hand. Conditions can come from an
 * imported workflow or be templated from tool output, so nothing here compiles
 * or runs code, and the only names in scope are `data` and a fixed allow-list of
 * helpers.
 *
 *   ternary    := or ( "?" ternary ":" ternary )?
 *   or         := and ( ( "||" | "??" ) and )*
 *   and        := equality ( "&&" equality )*
 *   equality   := relational ( ( "===" | "!==" | "==" | "!=" ) relational )*
 *   relational := additive ( ( "<" | "<=" | ">" | ">=" ) additive )*
 *   additive   := multiplicative ( ( "+" | "-" ) multiplicative )*
 *   multiplicative := unary ( ( "*" | "/" | "%" ) unary )*
 *   unary      := ( "!" | "-" | "+" ) unary | postfix
 *   postfix    := primary ( "." name | "?." name | "[" ternary "]" | "(" args ")" )*
 *   primary    := number | string | true | false | null | undefined | NaN
 *               | data | String | Number | Boolean | new RegExp "(" args ")"
 *               | "(" ternary ")"
 *
 * Calls are allowed only on `String`, `Number`, `Boolean`, the string methods
 * `includes`, `startsWith`, `endsWith`, `toLowerCase`, `toUpperCase`, `trim`,
 * the array method `includes`, and `.test` on a `new RegExp(...)`. Operators
 * keep their JavaScript meaning, but every coercion is done here on plain data,
 * so no `toString` or `valueOf` from the data is ever called.
 */

/** Longest condition accepted, in characters. */
export const MAX_CONDITION_LENGTH = 2000
/** Deepest nesting of parentheses, unary operators and ternaries. */
export const MAX_CONDITION_DEPTH = 32
/** Longest string an expression may build by concatenation. */
const MAX_STRING_LENGTH = 1_000_000
/** Longest regex pattern accepted. */
const MAX_PATTERN_LENGTH = 500

/** Every failure to parse or evaluate a condition, with the 1-based position. */
export class ConditionError extends Error {
  readonly position: number
  constructor(message: string, index: number) {
    super(`${message} at position ${index + 1}`)
    this.name = 'ConditionError'
    this.position = index + 1
  }
}

type TokenType = 'num' | 'str' | 'name' | 'punct' | 'eof'
interface Token {
  type: TokenType
  value: string
  num?: number
  pos: number
}

// Longest first, so `===` is not read as `==` then `=`.
const PUNCTUATORS = [
  '===', '!==', '...', '**=', '>>>',
  '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '=>', '**', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
  '(', ')', '[', ']', '{', '}', '.', ',', ';', ':', '?',
  '+', '-', '*', '/', '%', '<', '>', '!', '=', '&', '|', '^', '~',
]

/** Punctuators the tokenizer knows only so it can say what to write instead. */
const UNSUPPORTED: Record<string, string> = {
  '=': 'assignment is not allowed; use === to compare',
  '+=': 'assignment is not allowed; use === to compare',
  '-=': 'assignment is not allowed; use === to compare',
  '*=': 'assignment is not allowed; use === to compare',
  '/=': 'assignment is not allowed; use === to compare',
  '%=': 'assignment is not allowed; use === to compare',
  '&=': 'assignment is not allowed; use === to compare',
  '|=': 'assignment is not allowed; use === to compare',
  '^=': 'assignment is not allowed; use === to compare',
  '**=': 'assignment is not allowed; use === to compare',
  '++': 'increment and decrement are not allowed',
  '--': 'increment and decrement are not allowed',
  '=>': 'functions cannot be defined in a condition',
  ';': 'a condition is a single expression; remove the ";"',
  '{': 'object literals are not supported',
  '}': 'object literals are not supported',
  '...': 'spread is not supported',
  '**': 'the ** operator is not supported; use *',
  '&': 'bitwise operators are not supported; use && or ||',
  '|': 'bitwise operators are not supported; use && or ||',
  '^': 'bitwise operators are not supported',
  '~': 'bitwise operators are not supported',
  '<<': 'bitwise operators are not supported',
  '>>': 'bitwise operators are not supported',
  '>>>': 'bitwise operators are not supported',
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isNameStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch)
}

function isNamePart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch)
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const start = i
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!
      i += m[0].length
      if (isNamePart(src[i] ?? '')) throw new ConditionError('invalid number', start)
      tokens.push({ type: 'num', value: m[0], num: Number(m[0]), pos: start })
      continue
    }
    if (isNameStart(ch)) {
      while (i < src.length && isNamePart(src[i]!)) i++
      tokens.push({ type: 'name', value: src.slice(start, i), pos: start })
      continue
    }
    if (ch === '"' || ch === "'") {
      const { value, end } = readString(src, i, ch)
      tokens.push({ type: 'str', value, pos: start })
      i = end
      continue
    }
    if (ch === '`') {
      throw new ConditionError('template literals are not supported; join strings with +', start)
    }
    // `?.` followed by a digit is a ternary and a number, as in JavaScript.
    const punct = PUNCTUATORS.find(
      (p) => src.startsWith(p, i) && !(p === '?.' && /[0-9]/.test(src[i + 2] ?? '')),
    )
    if (punct === undefined) throw new ConditionError(`unexpected character "${ch}"`, start)
    const hint = UNSUPPORTED[punct]
    if (hint !== undefined) throw new ConditionError(hint, start)
    tokens.push({ type: 'punct', value: punct, pos: start })
    i += punct.length
  }
  tokens.push({ type: 'eof', value: '', pos: src.length })
  return tokens
}

function readString(src: string, start: number, quote: string): { value: string; end: number } {
  let out = ''
  let i = start + 1
  while (i < src.length) {
    const ch = src[i]!
    if (ch === quote) return { value: out, end: i + 1 }
    if (ch === '\n' || ch === '\r') break
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const esc = src[i + 1]
    if (esc === undefined) break
    const simple: Record<string, string> = {
      n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0',
    }
    if (esc === 'u') {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(src.slice(i + 2))
      const plain = /^[0-9a-fA-F]{4}/.exec(src.slice(i + 2))
      if (braced !== null) {
        const cp = parseInt(braced[1]!, 16)
        if (cp > 0x10ffff) throw new ConditionError('invalid unicode escape', i)
        out += String.fromCodePoint(cp)
        i += 2 + braced[0].length
      } else if (plain !== null) {
        out += String.fromCharCode(parseInt(plain[0], 16))
        i += 6
      } else {
        throw new ConditionError('invalid unicode escape', i)
      }
    } else if (esc === 'x') {
      const hex = /^[0-9a-fA-F]{2}/.exec(src.slice(i + 2))
      if (hex === null) throw new ConditionError('invalid hex escape', i)
      out += String.fromCharCode(parseInt(hex[0], 16))
      i += 4
    } else if (esc === '\n') {
      i += 2
    } else {
      out += simple[esc] ?? esc
      i += 2
    }
  }
  throw new ConditionError('unterminated string', start)
}

type Node =
  | { kind: 'literal'; value: unknown; pos: number }
  | { kind: 'data'; pos: number }
  | { kind: 'global'; name: 'String' | 'Number' | 'Boolean'; pos: number }
  | { kind: 'regexp'; args: Node[]; pos: number }
  | { kind: 'member'; object: Node; key: string | Node; optional: boolean; pos: number }
  | { kind: 'call'; callee: Node; args: Node[]; pos: number }
  | { kind: 'unary'; op: string; operand: Node; pos: number }
  | { kind: 'binary'; op: string; left: Node; right: Node; pos: number }
  | { kind: 'ternary'; test: Node; then: Node; else: Node; pos: number }

const LITERALS: Record<string, unknown> = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  NaN: NaN,
  Infinity: Infinity,
}

/** Names someone might reach for, and what to write instead. */
const NAME_HINTS: Record<string, string> = {
  this: '"this" is not available; read fields through data',
  typeof: 'typeof is not supported; compare with === undefined instead',
  instanceof: 'instanceof is not supported',
  in: 'the in operator is not supported; compare data.field !== undefined instead',
  delete: 'delete is not allowed',
  void: 'void is not supported; use undefined',
  function: 'functions cannot be defined in a condition',
  async: 'functions cannot be defined in a condition',
  await: 'await is not supported',
  yield: 'yield is not supported',
  let: 'declarations are not allowed',
  const: 'declarations are not allowed',
  var: 'declarations are not allowed',
  class: 'classes cannot be defined in a condition',
  import: 'import is not allowed',
}

const STRING_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'trim'])
const ARRAY_METHODS = new Set(['includes'])

class Parser {
  private i = 0
  private depth = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.ternary()
    const tok = this.peek()
    if (tok.type !== 'eof') throw unexpected(tok)
    return node
  }

  private peek(): Token {
    return this.tokens[this.i]!
  }

  private next(): Token {
    return this.tokens[this.i++]!
  }

  private isPunct(value: string): boolean {
    const tok = this.peek()
    return tok.type === 'punct' && tok.value === value
  }

  private expect(value: string): Token {
    const tok = this.peek()
    if (tok.type !== 'punct' || tok.value !== value) {
      if (tok.type === 'punct' && tok.value === ',') throw unexpected(tok)
      const found = tok.type === 'eof' ? 'the end of the condition' : `"${tok.value}"`
      throw new ConditionError(`expected "${value}" but found ${found}`, tok.pos)
    }
    return this.next()
  }

  private enter(pos: number): void {
    this.depth++
    if (this.depth > MAX_CONDITION_DEPTH) {
      throw new ConditionError(`the condition nests deeper than ${MAX_CONDITION_DEPTH} levels`, pos)
    }
  }

  private ternary(): Node {
    this.enter(this.peek().pos)
    const test = this.binary(0)
    let node = test
    if (this.isPunct('?')) {
      const pos = this.next().pos
      const then = this.ternary()
      this.expect(':')
      node = { kind: 'ternary', test, then, else: this.ternary(), pos }
    }
    this.depth--
    return node
  }

  private static readonly LEVELS: string[][] = [
    ['||', '??'],
    ['&&'],
    ['===', '!==', '==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ]

  private binary(level: number): Node {
    if (level >= Parser.LEVELS.length) return this.unary()
    const ops = Parser.LEVELS[level]!
    let left = this.binary(level + 1)
    for (;;) {
      const tok = this.peek()
      if (tok.type === 'name' && (tok.value === 'in' || tok.value === 'instanceof')) {
        throw new ConditionError(NAME_HINTS[tok.value]!, tok.pos)
      }
      if (tok.type !== 'punct' || !ops.includes(tok.value)) return left
      this.next()
      left = { kind: 'binary', op: tok.value, left, right: this.binary(level + 1), pos: tok.pos }
    }
  }

  private unary(): Node {
    const tok = this.peek()
    if (tok.type === 'punct' && (tok.value === '!' || tok.value === '-' || tok.value === '+')) {
      this.next()
      this.enter(tok.pos)
      const operand = this.unary()
      this.depth--
      return { kind: 'unary', op: tok.value, operand, pos: tok.pos }
    }
    return this.postfix()
  }

  private postfix(): Node {
    let node = this.primary()
    for (;;) {
      const tok = this.peek()
      if (tok.type !== 'punct') return node
      if (tok.value === '.' || tok.value === '?.') {
        this.next()
        const name = this.peek()
        if (tok.value === '?.' && (this.isPunct('[') || this.isPunct('('))) {
          throw new ConditionError('only ?. followed by a name is supported', name.pos)
        }
        if (name.type !== 'name') throw new ConditionError('expected a property name', name.pos)
        this.next()
        this.checkKey(name.value, name.pos)
        node = { kind: 'member', object: node, key: name.value, optional: tok.value === '?.', pos: name.pos }
      } else if (tok.value === '[') {
        this.next()
        const key = this.ternary()
        this.expect(']')
        if (key.kind === 'literal' && typeof key.value === 'string') this.checkKey(key.value, key.pos)
        node = { kind: 'member', object: node, key, optional: false, pos: tok.pos }
      } else if (tok.value === '(') {
        this.checkCallee(node, tok.pos)
        node = { kind: 'call', callee: node, args: this.args(), pos: tok.pos }
      } else {
        return node
      }
    }
  }

  private args(): Node[] {
    this.expect('(')
    const args: Node[] = []
    while (!this.isPunct(')')) {
      if (args.length > 0) {
        if (!this.isPunct(',')) this.expect(')')
        this.next()
      }
      args.push(this.ternary())
    }
    this.next()
    return args
  }

  /** Calls are checked against the allow-list at parse time, before anything runs. */
  private checkCallee(callee: Node, pos: number): void {
    if (callee.kind === 'global') return
    if (callee.kind === 'member' && typeof callee.key === 'string') {
      if (STRING_METHODS.has(callee.key) || ARRAY_METHODS.has(callee.key) || callee.key === 'test') return
      throw new ConditionError(`"${callee.key}" is not an allowed function; ${ALLOWED_CALLS}`, pos)
    }
    throw new ConditionError(`this cannot be called; ${ALLOWED_CALLS}`, pos)
  }

  private checkKey(key: string, pos: number): void {
    if (FORBIDDEN_KEYS.has(key)) throw new ConditionError(`"${key}" cannot be read`, pos)
  }

  private primary(): Node {
    const tok = this.next()
    if (tok.type === 'num') return { kind: 'literal', value: tok.num, pos: tok.pos }
    if (tok.type === 'str') return { kind: 'literal', value: tok.value, pos: tok.pos }
    if (tok.type === 'name') {
      if (Object.hasOwn(LITERALS, tok.value)) return { kind: 'literal', value: LITERALS[tok.value], pos: tok.pos }
      if (tok.value === 'data') return { kind: 'data', pos: tok.pos }
      if (tok.value === 'String' || tok.value === 'Number' || tok.value === 'Boolean') {
        if (!this.isPunct('(')) throw new ConditionError(`${tok.value} can only be called`, tok.pos)
        return { kind: 'global', name: tok.value, pos: tok.pos }
      }
      if (tok.value === 'new') {
        const ctor = this.next()
        if (ctor.type !== 'name' || ctor.value !== 'RegExp') {
          throw new ConditionError('only new RegExp(...) is supported', ctor.pos)
        }
        return { kind: 'regexp', args: this.args(), pos: tok.pos }
      }
      if (tok.value === 'RegExp') throw new ConditionError('write new RegExp(...)', tok.pos)
      if (Object.hasOwn(NAME_HINTS, tok.value)) throw new ConditionError(NAME_HINTS[tok.value]!, tok.pos)
      throw new ConditionError(`unknown name "${tok.value}"; a condition can only read data`, tok.pos)
    }
    if (tok.type === 'punct' && tok.value === '(') {
      // ternary() counts the level this parenthesis opens.
      const inner = this.ternary()
      this.expect(')')
      return inner
    }
    if (tok.type === 'punct' && tok.value === '/') {
      throw new ConditionError('regex literals are not supported; write new RegExp("...").test(...)', tok.pos)
    }
    throw unexpected(tok)
  }
}

function unexpected(tok: Token): ConditionError {
  if (tok.type === 'eof') return new ConditionError('the condition ends too early', tok.pos)
  if (tok.type === 'punct' && tok.value === ',') {
    return new ConditionError('a comma is only allowed between call arguments', tok.pos)
  }
  return new ConditionError(`unexpected "${tok.value}"`, tok.pos)
}

const ALLOWED_CALLS =
  'allowed calls are String, Number, Boolean, includes, startsWith, endsWith, toLowerCase, toUpperCase, trim and new RegExp(...).test'

/** A compiled `new RegExp(...)`. Kept opaque so data never reaches the RegExp object. */
class SafeRegex {
  constructor(readonly re: RegExp) {}
}

/** Plain JSON-shaped data: arrays and objects whose prototype is Object's or null. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

function isObjectLike(v: unknown): boolean {
  return (v !== null && typeof v === 'object') || typeof v === 'function'
}

/** JavaScript's ToString, done here so no method on the data is ever invoked. */
function toStr(v: unknown, depth = 0): string {
  if (typeof v === 'string') return v
  if (v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v)
  }
  if (Array.isArray(v) && depth < 8) {
    return v.map((x) => (x === null || x === undefined ? '' : toStr(x, depth + 1))).join(',')
  }
  return '[object Object]'
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v === undefined) return NaN
  if (v === null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  return Number(toStr(v))
}

/** ToPrimitive: an object becomes its string form; primitives pass through. */
function toPrim(v: unknown): unknown {
  return isObjectLike(v) ? toStr(v) : v
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (isObjectLike(a) && isObjectLike(b)) return a === b
  // Both operands are primitives here, where == cannot run any code.
  return toPrim(a) == toPrim(b)
}

const CHAIN_SHORT = Symbol('optional chain short-circuit')

/** V8's linear-time engine flag; the engine process enables it at startup. */
const LINEAR_FLAG = 'l'

function compileRegex(args: unknown[], pos: number): SafeRegex {
  const pattern = toStr(args[0])
  const flags = args[1] === undefined ? '' : toStr(args[1])
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ConditionError(`the regex is longer than ${MAX_PATTERN_LENGTH} characters`, pos)
  }
  for (const f of flags) {
    if (f === 'i') {
      throw new ConditionError(
        'the regex i flag is not supported; lowercase the text with .toLowerCase() and write the pattern in lowercase',
        pos,
      )
    }
    if (f !== 'm' && f !== 's') throw new ConditionError(`the regex flag "${f}" is not supported; use m or s`, pos)
  }
  if (new Set(flags).size !== flags.length) throw new ConditionError('a regex flag is repeated', pos)
  try {
    // The `l` flag runs V8's non-backtracking engine, so no pattern can hang a run.
    return new SafeRegex(new RegExp(pattern, flags + LINEAR_FLAG))
  } catch (e) {
    const msg = (e as Error).message
    if (msg.startsWith('Invalid flags')) {
      throw new ConditionError(
        'regex conditions need the linear-time regex engine, which this runtime has not enabled',
        pos,
      )
    }
    if (msg.includes('linear time')) {
      throw new ConditionError(
        'the regex needs backtracking (lookaround, backreferences or \\b), which conditions do not allow',
        pos,
      )
    }
    throw new ConditionError(`invalid regex: ${msg.replace(/^Invalid regular expression: /, '')}`, pos)
  }
}

function kindOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  return typeof v === 'object' ? 'an object' : String(typeof v === 'string' ? 'a string' : v)
}

function readMember(object: unknown, key: unknown, pos: number): unknown {
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw new ConditionError('a property key must be a string or a number', pos)
  }
  const name = typeof key === 'number' ? String(key) : key
  if (FORBIDDEN_KEYS.has(name)) throw new ConditionError(`"${name}" cannot be read`, pos)
  if (object === undefined || object === null) {
    throw new ConditionError(`cannot read "${name}" of ${String(object)}`, pos)
  }
  if (typeof object === 'string') {
    if (name === 'length') return object.length
    if (/^(0|[1-9][0-9]*)$/.test(name)) return object[Number(name)]
    return undefined
  }
  if (Array.isArray(object)) {
    if (name === 'length') return object.length
    if (!/^(0|[1-9][0-9]*)$/.test(name)) return undefined
  } else if (!isPlainObject(object)) {
    if (typeof object === 'number' || typeof object === 'boolean') return undefined
    throw new ConditionError(`cannot read "${name}" of ${kindOf(object)}`, pos)
  }
  // Own data properties only: never a getter, never something inherited.
  const desc = Object.getOwnPropertyDescriptor(object, name)
  if (desc === undefined || !('value' in desc)) return undefined
  const value: unknown = desc.value
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  return value
}

function callMethod(receiver: unknown, name: string, args: unknown[], pos: number): unknown {
  if (typeof receiver === 'string' && STRING_METHODS.has(name)) {
    switch (name) {
      case 'includes':
        return receiver.includes(toStr(args[0]), toNum(args[1] ?? 0))
      case 'startsWith':
        return receiver.startsWith(toStr(args[0]), toNum(args[1] ?? 0))
      case 'endsWith':
        return receiver.endsWith(toStr(args[0]), args[1] === undefined ? receiver.length : toNum(args[1]))
      case 'toLowerCase':
        return receiver.toLowerCase()
      case 'toUpperCase':
        return receiver.toUpperCase()
      case 'trim':
        return receiver.trim()
    }
  }
  if (Array.isArray(receiver) && name === 'includes') {
    const needle = args[0]
    const from = toNum(args[1] ?? 0)
    for (let i = Math.max(0, from < 0 ? receiver.length + from : from || 0); i < receiver.length; i++) {
      const x: unknown = receiver[i]
      if (x === needle || (Number.isNaN(x) && Number.isNaN(needle))) return true
    }
    return false
  }
  if (receiver instanceof SafeRegex && name === 'test') {
    return receiver.re.test(toStr(args[0]))
  }
  if (receiver === undefined || receiver === null) {
    throw new ConditionError(`cannot call "${name}" on ${String(receiver)}`, pos)
  }
  throw new ConditionError(`"${name}" cannot be called on ${kindOf(receiver)}`, pos)
}

function evaluate(node: Node, data: unknown): unknown {
  const v = evalNode(node, data)
  return v === CHAIN_SHORT ? undefined : v
}

function evalNode(node: Node, data: unknown): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'data':
      return data
    case 'global':
      throw new ConditionError(`${node.name} can only be called`, node.pos)
    case 'regexp':
      return compileRegex(
        node.args.map((a) => evaluate(a, data)),
        node.pos,
      )
    case 'member': {
      const object = evalNode(node.object, data)
      if (object === CHAIN_SHORT) return CHAIN_SHORT
      if (node.optional && (object === undefined || object === null)) return CHAIN_SHORT
      const key = typeof node.key === 'string' ? node.key : evaluate(node.key, data)
      if (typeof object === 'string' && typeof key === 'string' && STRING_METHODS.has(key)) {
        throw new ConditionError(`"${key}" can only be called`, node.pos)
      }
      return readMember(object, key, node.pos)
    }
    case 'call': {
      const callee = node.callee
      if (callee.kind === 'global') {
        const arg = node.args.length > 0 ? evaluate(node.args[0]!, data) : undefined
        if (callee.name === 'String') return node.args.length === 0 ? '' : toStr(arg)
        if (callee.name === 'Number') return node.args.length === 0 ? 0 : toNum(arg)
        return truthy(arg)
      }
      if (callee.kind !== 'member' || typeof callee.key !== 'string') {
        throw new ConditionError('this cannot be called', node.pos)
      }
      const receiver = evalNode(callee.object, data)
      if (receiver === CHAIN_SHORT) return CHAIN_SHORT
      if (callee.optional && (receiver === undefined || receiver === null)) return CHAIN_SHORT
      const args = node.args.map((a) => evaluate(a, data))
      return callMethod(receiver, callee.key, args, callee.pos)
    }
    case 'unary': {
      const v = evaluate(node.operand, data)
      if (node.op === '!') return !truthy(v)
      return node.op === '-' ? -toNum(v) : toNum(v)
    }
    case 'ternary':
      return truthy(evaluate(node.test, data)) ? evaluate(node.then, data) : evaluate(node.else, data)
    case 'binary':
      return evalBinary(node, data)
  }
}

function evalBinary(node: Extract<Node, { kind: 'binary' }>, data: unknown): unknown {
  const left = evaluate(node.left, data)
  switch (node.op) {
    case '&&':
      return truthy(left) ? evaluate(node.right, data) : left
    case '||':
      return truthy(left) ? left : evaluate(node.right, data)
    case '??':
      return left === undefined || left === null ? evaluate(node.right, data) : left
  }
  const right = evaluate(node.right, data)
  switch (node.op) {
    case '===':
      return left === right
    case '!==':
      return left !== right
    case '==':
      return looseEquals(left, right)
    case '!=':
      return !looseEquals(left, right)
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const a = toPrim(left)
      const b = toPrim(right)
      if (typeof a === 'string' && typeof b === 'string') return compare(node.op, a, b)
      return compare(node.op, toNum(a), toNum(b))
    }
    case '+': {
      const a = toPrim(left)
      const b = toPrim(right)
      if (typeof a === 'string' || typeof b === 'string') {
        const sa = toStr(a)
        const sb = toStr(b)
        if (sa.length + sb.length > MAX_STRING_LENGTH) {
          throw new ConditionError(`the string built here is longer than ${MAX_STRING_LENGTH} characters`, node.pos)
        }
        return sa + sb
      }
      return toNum(a) + toNum(b)
    }
    case '-':
      return toNum(left) - toNum(right)
    case '*':
      return toNum(left) * toNum(right)
    case '/':
      return toNum(left) / toNum(right)
    case '%':
      return toNum(left) % toNum(right)
  }
  throw new ConditionError(`unsupported operator "${node.op}"`, node.pos)
}

function compare<T extends string | number>(op: string, a: T, b: T): boolean {
  if (op === '<') return a < b
  if (op === '<=') return a <= b
  if (op === '>') return a > b
  return a >= b
}

function truthy(v: unknown): boolean {
  return Boolean(v)
}

/** Parse only, so an editor can flag a broken condition before it runs. */
export function parseCondition(expression: string): void {
  compile(expression)
}

function compile(expression: string): Node {
  if (expression.length > MAX_CONDITION_LENGTH) {
    throw new ConditionError(`the condition is longer than ${MAX_CONDITION_LENGTH} characters`, MAX_CONDITION_LENGTH)
  }
  return new Parser(tokenize(expression)).parse()
}

/**
 * Evaluate a condition against `data` and return its raw value. Throws only
 * `ConditionError`; anything else escaping is a bug in this module.
 */
export function evaluateCondition(expression: string, data: unknown): unknown {
  return evaluate(compile(expression), data)
}
