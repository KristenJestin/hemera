/**
 * The closed world of a test file (#342, round 7): the reader is certain of a file only if it can
 * see every piece of code that runs while the file is collected, and none of it can declare a test
 * the reader has not read. That code is the file's own code outside its tests' and hooks'
 * callbacks, every module it loads (followed transitively in the repository), and the setup files
 * its runner's configuration names. Anything the reader cannot see whole, or that may declare a
 * test, makes the file uncertain, and the key line decides.
 */

import {
  EXPRESSION_KEYWORDS,
  HEADS,
  NOT_DECLARATIONS,
  type Token,
  declaration,
  importClause,
  jsTokens,
  statementStart,
} from './test-sources.ts'

/** The repository a test file is read in: its path there, and a reader of any other file of it. */
export interface SourceWorld {
  readonly path: string
  readonly read: (path: string) => string | null
}

/** The modules that are a runner: their bindings are the runner's, under their own names only. */
const RUNNER_MODULES = new Set([
  'vitest',
  'vite-plus/test',
  '@jest/globals',
  'node:test',
  'mocha',
  'bun:test',
  '@playwright/test',
])
/** Node's own modules, which declare no test (`node:test` is a runner; `vm` runs strings). */
const NODE_MODULES = new Set([
  'assert',
  'assert/strict',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'timers/promises',
  'url',
  'util',
  'worker_threads',
  'zlib',
])
/** Files a module may load that hold no code. */
const DATA = new Set([
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.txt',
])
/** The extensions a JavaScript or TypeScript module is found under, in the order tried. */
const CODE = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
/** A runner's configuration files, at the test file's folder or any above it. */
const CONFIGS = [
  ...['vitest.config', 'vite.config', 'vitest.workspace', 'vitest.projects', 'jest.config'].flatMap(
    (name) => CODE.map((extension) => `${name}${extension}`),
  ),
  'jest.config.json',
  'package.json',
  ...['.js', '.cjs', '.json', '.jsonc', '.yml', '.yaml'].map((extension) => `.mocharc${extension}`),
]
/** The keys of a configuration that name setup files, run in every test file. */
const SETUP_KEYS = new Set(['setupFiles', 'setupFilesAfterEnv'])
/** The keys of a configuration that bring in what the reader does not follow. */
const OPAQUE_KEYS = new Set(['projects', 'workspace', 'extends', 'preset', 'require', 'file'])
/** How much the reader follows at most: past it, the file is uncertain. */
const MAX_MODULES = 2_000
const MAX_READ = 32_000_000

/**
 * The names the file may use while it is collected without declaring them: the language's
 * keywords and literals, its standard globals and Node's, TypeScript's own types, and the runners'
 * APIs. One closed list: any other name not declared in the file makes it uncertain.
 */
const KNOWN = new Set([
  ...[
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'let',
    'static',
    'async',
    'await',
    'of',
    'as',
    'from',
    'get',
    'set',
    'null',
    'true',
    'false',
    'undefined',
    'type',
    'interface',
    'implements',
    'readonly',
    'public',
    'private',
    'protected',
    'abstract',
    'keyof',
    'infer',
    'is',
    'satisfies',
    'declare',
    'enum',
    'namespace',
    'override',
    'accessor',
  ],
  ...[
    'globalThis',
    'NaN',
    'Infinity',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'BigInt',
    'Math',
    'JSON',
    'Date',
    'RegExp',
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'ReferenceError',
    'AggregateError',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'WeakRef',
    'Proxy',
    'Reflect',
    'Intl',
    'ArrayBuffer',
    'DataView',
    'Uint8Array',
    'Int8Array',
    'Uint16Array',
    'Int16Array',
    'Uint32Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'encodeURIComponent',
    'decodeURIComponent',
    'encodeURI',
    'decodeURI',
    'structuredClone',
    'queueMicrotask',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'console',
    'process',
    'Buffer',
    'URL',
    'URLSearchParams',
    'TextEncoder',
    'TextDecoder',
    'AbortController',
    'AbortSignal',
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
    'arguments',
  ],
  ...[
    'string',
    'number',
    'boolean',
    'any',
    'unknown',
    'never',
    'object',
    'symbol',
    'bigint',
    'Record',
    'Partial',
    'Required',
    'Readonly',
    'ReadonlyArray',
    'Pick',
    'Omit',
    'Exclude',
    'Extract',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'Awaited',
    'InstanceType',
    'PromiseLike',
    'Iterable',
    'AsyncIterable',
  ],
  ...[
    ...HEADS,
    'expect',
    'vi',
    'jest',
    'beforeEach',
    'afterEach',
    'beforeAll',
    'afterAll',
    'before',
    'after',
  ],
])
/** The runners' hooks, whose callbacks run after the file is collected, as tests' do. */
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'before', 'after'])
/** The names that run code from a string, which the reader cannot see. */
const FROM_STRINGS = new Set(['eval', 'Function'])
/** Calls that load the module their first argument names. */
const LOADERS = new Set([
  'require',
  'importActual',
  'requireActual',
  'importMock',
  'requireMock',
  'mock',
  'doMock',
])
/** The keywords a `(` after which opens a block's condition, not a function's parameters. */
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])

/** Whether a name is a member (`a.name`, `a?.name`), not a spread (`...name`). */
const member = (tokens: ReadonlyArray<Token>, at: number): boolean =>
  tokens[at - 1]?.text === '.' && tokens[at - 2]?.text !== '.'
/** Whether a name is a key (`{ name: … }`, `{ name?: T }`): what follows `{`, `,`, `;` and a `:`. */
const keyAt = (tokens: ReadonlyArray<Token>, at: number): boolean => {
  const before = tokens[at - 1]
  const after = tokens[at + 1]?.text
  const keyed =
    before === undefined ||
    ['{', ',', ';', '}'].includes(before.text) ||
    (tokens[at]?.newline ?? false)
  return keyed && (after === ':' || (after === '?' && tokens[at + 2]?.text === ':'))
}

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}
const folderOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/** A path made plain (`a/./b/../c` is `a/c`); null when it leaves the repository. */
const plain = (path: string): string | null => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return null
  }
  return parts.join('/')
}

/** A module a specifier names, as found: its path and its text; null when none is found. */
interface Found {
  readonly path: string
  readonly text: string
}

/**
 * The file a module path names, tried as written, then with each code extension, a `.js` as its
 * TypeScript source, and as a folder's `index`.
 */
const locate = (base: string, read: SourceWorld['read']): Found | null => {
  const extension = extensionOf(base)
  const stem = base.slice(0, base.length - extension.length)
  const sources = ['.js', '.jsx', '.mjs', '.cjs'].includes(extension)
    ? CODE.slice(0, 4).map((one) => `${stem}${one}`)
    : []
  for (const path of [
    base,
    ...CODE.map((one) => `${base}${one}`),
    ...sources,
    ...CODE.map((one) => `${base}/index${one}`),
  ]) {
    const text = read(path)
    if (text !== null) return { path, text }
  }
  return null
}

/** What a specifier loads: a runner, a module of Node or a package, a file found, or the unknown. */
type Loaded =
  | { readonly kind: 'runner' | 'inert' }
  | { readonly kind: 'file'; readonly file: Found }
  | { readonly kind: 'unknown' }

/** A package's name (`zod`, `@scope/name/sub`): a module installed, which the reader does not read. */
const PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.@/-]+)?$/i

const loaded = (specifier: string, from: string, read: SourceWorld['read']): Loaded => {
  if (RUNNER_MODULES.has(specifier)) return { kind: 'runner' }
  if (specifier.startsWith('node:')) {
    return NODE_MODULES.has(specifier.slice(5)) ? { kind: 'inert' } : { kind: 'unknown' }
  }
  if (NODE_MODULES.has(specifier)) return { kind: 'inert' }
  if (/[?!#]/.test(specifier.slice(1))) return { kind: 'unknown' }
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (!relative && !PACKAGE.test(specifier)) return { kind: 'unknown' }
  const path = plain(relative ? `${folderOf(from)}/${specifier}` : specifier)
  if (path === null) return { kind: 'unknown' }
  const file = locate(path, read)
  if (file !== null) return { kind: 'file', file }
  // A package is the lockfile's, installed from a registry: not read. Any other name (a relative
  // module not found, an alias, a workspace's package, an undeclared name) may be the repository's.
  return registered(specifier, from, read) ? { kind: 'inert' } : { kind: 'unknown' }
}

/** The fields of a `package.json` that declare the packages its code may import. */
const DEPENDENCIES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
/** A version that is no registry's: the repository's own code under a package's name. */
const LOCAL_VERSION = /^(?:workspace|file|link|portal):/

/**
 * Whether a package is installed from a registry: declared in a `package.json` from the
 * importing file's folder up to the root, under a version no repository path stands for. A
 * repository whose `package.json` declares `workspaces` links its own packages by name under any
 * version, so none of its packages is taken as a registry's.
 */
const registered = (specifier: string, from: string, read: SourceWorld['read']): boolean => {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
  let version: string | null = null
  for (let folder = folderOf(from); ; folder = folderOf(folder)) {
    const text = read(folder === '' ? 'package.json' : `${folder}/package.json`)
    if (text !== null) {
      const manifest = manifestOf(text)
      if (manifest === null || manifest.workspaces) return false
      version ??= manifest.versions.get(name) ?? null
    }
    if (folder === '') break
  }
  return version !== null && !LOCAL_VERSION.test(version)
}

/** What a `package.json` says of its packages: whether it declares workspaces, and each version. */
interface Manifest {
  readonly workspaces: boolean
  readonly versions: ReadonlyMap<string, string>
}

/** A `package.json` read with the tokenizer: null when it is not an object of plain entries. */
const manifestOf = (text: string): Manifest | null => {
  const { tokens, ends, certain } = jsTokens(text)
  if (!certain || tokens[0]?.text !== '{') return null
  const versions = new Map<string, string>()
  let workspaces = false
  for (let at = 1; at < tokens.length - 1; at += 1) {
    const key = tokens[at]
    if (key?.kind !== 'string' || tokens[at + 1]?.text !== ':') continue
    if (key.text === 'workspaces') workspaces = true
    if (!DEPENDENCIES.includes(key.text) || tokens[at + 2]?.text !== '{') continue
    const close = ends.get(at + 2) ?? at + 2
    for (let entry = at + 3; entry < close; entry += 1) {
      const value = tokens[entry + 2]
      if (
        tokens[entry]?.kind === 'string' &&
        tokens[entry + 1]?.text === ':' &&
        value?.kind === 'string'
      )
        versions.set(tokens[entry]?.text ?? '', value.text)
    }
    at = close
  }
  return { workspaces, versions }
}

/** A JavaScript module's facts: the specifiers it loads, and whether it is certain on its own. */
interface ModuleFacts {
  readonly certain: boolean
  readonly loads: ReadonlyArray<string>
  /** The names its imports of packages bind, which the test file may not use while collected. */
  readonly packaged: ReadonlySet<string>
}

/** The literal specifier of a loading call or clause at a token, null when it is not a literal. */
const literalAt = (tokens: ReadonlyArray<Token>, at: number): string | null => {
  const one = tokens[at]
  return one?.kind === 'string' && !(one.quote === '`' && one.templated)
    ? one.quote === '`'
      ? one.body
      : one.text
    : null
}

/**
 * What a JavaScript module loads, and whether it may declare a test: a runner's token in it
 * (`test`, `it`, `describe`, `suite`, a `context(` call), a runner's module, code run from a string,
 * a specifier not a literal: uncertain. In the test file itself (`own`), a runner's bindings must
 * have their own names, and every name used while the file is collected must be known.
 */
const moduleFacts = (code: string, own: boolean): ModuleFacts => {
  const { tokens, closer, ends, certain } = jsTokens(code)
  let known = certain
  const loads: string[] = []
  const packaged = new Set<string>()
  const clauses = new Set<number>()
  for (const [at, one] of tokens.entries()) {
    if (one.kind !== 'name' || keyAt(tokens, at)) continue
    const call = tokens[at + 1]?.text === '('
    // `vi.mock('x')`, `vi.importActual('x')`, `jest.requireActual('x')`: they load x.
    if (member(tokens, at)) {
      const owner = tokens[at - 2]?.text ?? ''
      if ((owner === 'vi' || owner === 'jest') && LOADERS.has(one.text) && call) {
        const specifier = literalAt(tokens, at + 2)
        if (specifier === null) known = false
        else loads.push(specifier)
      }
      continue
    }
    if (FROM_STRINGS.has(one.text)) known = false
    if (!own && HEADS.has(one.text) && (one.text !== 'context' || call)) known = false
    const isImport = one.text === 'import' && !call && statementStart(tokens, at)
    const isExportFrom = one.text === 'export' && statementStart(tokens, at)
    if (isImport || isExportFrom) {
      const first = tokens[at + 1]
      if (isImport && first?.kind === 'string') {
        loads.push(literalAt(tokens, at + 1) ?? '')
        continue
      }
      // `import type …` is erased: it loads nothing, its names are types.
      const typed =
        isImport && first?.text === 'type' && !['from', ','].includes(tokens[at + 2]?.text ?? '')
      const clause = importClause(tokens, at + 1)
      // `export … from 'x'` and `export * from 'x'` load x; `export const …` loads nothing.
      let end = clause.end
      if (isExportFrom && first?.text === '*')
        end = at + 2 + (tokens[at + 2]?.text === 'as' ? 2 : 0)
      if (isExportFrom && first?.text === '{') end = (ends.get(at + 1) ?? at) + 1
      if (tokens[end]?.text !== 'from') {
        if (isImport) known = false
        continue
      }
      for (let index = at + 1; index < end; index += 1) clauses.add(index)
      const specifier = literalAt(tokens, end + 1)
      if (specifier === null) {
        known = false
        continue
      }
      if (typed) continue
      loads.push(specifier)
      const runner = RUNNER_MODULES.has(specifier)
      if (isExportFrom) {
        if (runner) known = false
        continue
      }
      // A runner under its own names only: no rename, no namespace, no default under another.
      if (runner && (!own || clause.names.length === 0)) known = false
      for (const name of clause.names) {
        if (runner && name.local !== name.imported) known = false
        const builtin = NODE_MODULES.has(specifier.replace(/^node:/, ''))
        if (!runner && !specifier.startsWith('.') && !builtin) packaged.add(name.local)
      }
      continue
    }
    // `import('x')`, `require('x')`.
    if ((one.text === 'import' || one.text === 'require') && call) {
      const specifier = literalAt(tokens, at + 2)
      if (specifier === null) {
        known = false
        continue
      }
      loads.push(specifier)
      if (RUNNER_MODULES.has(specifier) && !(own && plainRequire(tokens, at, closer))) known = false
      continue
    }
    // `createRequire(…)` makes a `require`: read only under that name.
    if (one.text === 'createRequire' && call) {
      if (!(tokens[at - 1]?.text === '=' && tokens[at - 2]?.text === 'require')) known = false
    }
    // `require` passed on as a value loads what the reader cannot see.
    if (
      one.text === 'require' &&
      !call &&
      tokens[at + 1]?.text !== '.' &&
      tokens[at - 1]?.text !== 'const'
    )
      known = false
  }
  if (own && known) known = collectedKnown(tokens, closer, ends, clauses, packaged)
  return { certain: known, loads, packaged }
}

/**
 * Whether a `require` of a runner at a token binds its tests under their own names:
 * `const { test, describe } = require('node:test')`, or `const test = require('node:test')`.
 */
const plainRequire = (
  tokens: ReadonlyArray<Token>,
  at: number,
  closer: ReadonlyMap<number, number>,
): boolean => {
  if (tokens[at]?.text !== 'require') return false
  const after = tokens[(closer.get(at + 1) ?? tokens.length) + 1]?.text
  if (
    after !== undefined &&
    after !== ';' &&
    !(tokens[(closer.get(at + 1) ?? 0) + 1]?.newline ?? true)
  )
    return false
  if (tokens[at - 1]?.text !== '=') return false
  const bound = tokens[at - 2]
  if (bound?.kind === 'name') return bound.text === 'test' && tokens[at - 3]?.text === 'const'
  if (bound?.text !== '}') return false
  for (let index = at - 3; index >= 0; index -= 1) {
    const one = tokens[index]
    if (one?.text === '{') return tokens[index - 1]?.text === 'const'
    if (one?.text === ',') continue
    if (
      one?.kind !== 'name' ||
      !(HEADS.has(one.text) || NOT_DECLARATIONS.has(one.text) || KNOWN.has(one.text))
    )
      return false
  }
  return false
}

/**
 * The names a file declares: its imports, its `const`, `let` and `var` bindings and their
 * patterns, its functions, classes, enums and types, their parameters, its `catch` bindings. A
 * `declare` declaration is TypeScript's word that the value is defined elsewhere: none.
 */
const declaredIn = (
  tokens: ReadonlyArray<Token>,
  ends: ReadonlyMap<number, number>,
  clauses: ReadonlySet<number>,
  packaged: ReadonlySet<string>,
): ReadonlySet<string> => {
  const declared = new Set<string>()
  // The binding names of a pattern or a parameter list between two tokens.
  const bindings = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      const one = tokens[at]
      if (one?.kind !== 'name') continue
      const before = tokens[at - 1]?.text ?? ''
      const after = tokens[at + 1]?.text ?? ''
      const spread = before === '.' && tokens[at - 2]?.text === '.' && tokens[at - 3]?.text === '.'
      const opens = ['(', ',', '{', '['].includes(before)
      if ((opens || spread) && [',', ')', '=', '}', ']', ':', '?'].includes(after))
        declared.add(one.text)
    }
  }
  for (const [at, one] of tokens.entries()) {
    if (clauses.has(at) && one.kind === 'name' && !packaged.has(one.text)) {
      const next = tokens[at + 1]?.text
      if (next === ',' || next === '}' || next === 'from') declared.add(one.text)
    }
    if (one.kind !== 'name' || member(tokens, at)) continue
    const next = tokens[at + 1]
    if (['const', 'let', 'var'].includes(one.text) && tokens[at - 1]?.text !== 'declare') {
      if (next?.kind === 'name') declared.add(next.text)
      else if (next?.text === '{' || next?.text === '[')
        bindings(at + 1, ends.get(at + 1) ?? at + 1)
    }
    if (
      ['function', 'class', 'enum', 'interface', 'type'].includes(one.text) &&
      next?.kind === 'name'
    )
      if (tokens[at - 1]?.text !== 'declare') declared.add(next.text)
  }
  // Parameters: an arrow's, a function's, a method's (`name(…) {`), a `catch`'s.
  for (const [at, one] of tokens.entries()) {
    if (one.text !== '(') continue
    const close = ends.get(at)
    if (close === undefined) continue
    const after = tokens[close + 1]?.text
    const before = tokens[at - 1]
    const arrow = after === '=' && tokens[close + 2]?.text === '>'
    const body = after === '{' || after === ':'
    if (
      arrow ||
      (body && before !== undefined && !CONTROL.has(before.text)) ||
      before?.text === 'catch'
    )
      bindings(at + 1, close)
  }
  // `x => …`: a single parameter.
  for (const [at, one] of tokens.entries()) {
    if (one.kind === 'name' && tokens[at + 1]?.text === '=' && tokens[at + 2]?.text === '>')
      declared.add(one.text)
  }
  return declared
}

/**
 * Whether every name the test file uses while it is collected is known: declared in the file,
 * imported from a module the reader follows, on the closed list, a property, a key or a member. The
 * callbacks of its tests and hooks run once it is collected, and are not read here.
 */
const collectedKnown = (
  tokens: ReadonlyArray<Token>,
  closer: ReadonlyMap<number, number>,
  ends: ReadonlyMap<number, number>,
  clauses: ReadonlySet<number>,
  packaged: ReadonlySet<string>,
): boolean => {
  const declared = declaredIn(tokens, ends, clauses, packaged)
  // The argument lists of the tests and the hooks: skipped whole.
  const skipped = new Map<number, number>()
  for (const [at, one] of tokens.entries()) {
    if (one.kind !== 'name' || member(tokens, at)) continue
    if (HEADS.has(one.text)) {
      const read = declaration(tokens, at, closer)
      if (read !== null && read !== 'other' && !read.describe) {
        skipped.set(read.open, closer.get(read.open) ?? tokens.length)
      }
    }
    let last = at
    while (tokens[last + 1]?.text === '.' && tokens[last + 2]?.kind === 'name') last += 2
    const hook = HOOKS.has(tokens[last]?.text ?? '') && (last === at || HEADS.has(one.text))
    if (hook && tokens[last + 1]?.text === '(') {
      skipped.set(last + 1, closer.get(last + 1) ?? tokens.length)
    }
  }
  // An enum's or an interface's body, and a type alias's right side, hold no value.
  for (let at = 0; at < tokens.length; at += 1) {
    const end = skipped.get(at)
    if (end !== undefined) {
      at = end
      continue
    }
    const one = tokens[at]
    if (one === undefined || one.kind !== 'name' || clauses.has(at)) continue
    const before = tokens[at - 1]?.text ?? ''
    const after = tokens[at + 1]?.text ?? ''
    if (member(tokens, at) || keyAt(tokens, at)) continue
    if (['as', 'satisfies', 'is', 'keyof', 'infer'].includes(before)) continue
    // A method declared (`{ a() {} }`, `{ a(): T {} }`).
    const keyed = ['{', ',', ';', '}'].includes(before) || before === '' || one.newline
    if (keyed && after === '(') {
      const close = ends.get(at + 1)
      const body = close === undefined ? '' : (tokens[close + 1]?.text ?? '')
      if (body === '{' || body === ':') continue
    }
    if (EXPRESSION_KEYWORDS.has(one.text) || KNOWN.has(one.text) || declared.has(one.text)) continue
    return false
  }
  return true
}

/**
 * The setup files a runner's configuration file names (`setupFiles`, `setupFilesAfterEnv`), each
 * as written; null when the configuration brings in what the reader does not follow (`projects`,
 * `extends`, a `preset`, a mocha `require`), or names its setup files with anything but literals.
 */
const setupOf = (name: string, text: string): ReadonlyArray<string> | null => {
  if (name.startsWith('.mocharc')) return /\b(?:require|file|spec)\b/.test(text) ? null : []
  if (name === 'package.json') {
    // A script's runner flags load modules before every test file (`--import`, `--require`).
    if (/--import|--require|--loader|\s-r\s/.test(text)) return null
    if (/"jest"\s*:|"mocha"\s*:/.exec(text) === null) return []
  }
  const { tokens, ends } = jsTokens(text)
  const files: string[] = []
  for (const [at, one] of tokens.entries()) {
    if (tokens[at + 1]?.text !== ':' || (one.kind !== 'string' && one.kind !== 'name')) continue
    const key = one.text
    if (OPAQUE_KEYS.has(key)) return null
    if (!SETUP_KEYS.has(key)) continue
    const value = tokens[at + 2]
    if (value?.kind === 'string') {
      files.push(value.text)
      continue
    }
    if (value?.text !== '[') return null
    const close = ends.get(at + 2) ?? tokens.length
    for (let index = at + 3; index < close; index += 1) {
      const item = tokens[index]
      if (item?.text === ',') continue
      const literal = literalAt(tokens, index)
      if (literal === null) return null
      files.push(literal)
    }
  }
  return files
}

/**
 * Whether a JavaScript or TypeScript test file is read in a closed world: its own code known
 * while it is collected, and every module it loads, and every setup file of its runner, found in
 * the repository, read, and free of anything that may declare a test. Linear in what it reads:
 * each module is read once, through a walk that keeps no recursion. A cycle is uncertain.
 */
export const jsWorldCertain = (code: string, world: SourceWorld): boolean => {
  try {
    return jsWorld(code, world)
  } catch {
    return false
  }
}

const jsWorld = (code: string, world: SourceWorld): boolean => {
  const own = moduleFacts(code, true)
  if (!own.certain) return false
  const roots: Array<{ readonly specifier: string; readonly from: string }> = own.loads.map(
    (specifier) => ({ specifier, from: world.path }),
  )
  // The setup files of every runner configuration from the file's folder up.
  const folders: string[] = []
  for (let folder = folderOf(world.path); ; folder = folderOf(folder)) {
    folders.push(folder)
    if (folder === '') break
  }
  for (const folder of folders) {
    for (const name of CONFIGS) {
      const path = folder === '' ? name : `${folder}/${name}`
      const text = world.read(path)
      if (text === null) continue
      const setups = setupOf(name, text)
      if (setups === null) return false
      for (const setup of setups) {
        const relative = setup.replace(/^<rootDir>\//, './')
        roots.push({ specifier: relative.startsWith('.') ? relative : `./${relative}`, from: path })
      }
      // A configuration that loads a module of the repository may take its setup files from it.
      const isCode = !name.endsWith('.json') && !name.startsWith('.mocharc')
      const loads = isCode ? moduleFacts(text, false).loads : []
      if (loads.some((one) => !['runner', 'inert'].includes(loaded(one, path, world.read).kind)))
        return false
    }
  }
  // A walk over the modules, each read once: 1 while on the path, 2 once done.
  const state = new Map<string, 1 | 2>()
  let size = 0
  const stack: Array<{
    readonly path: string
    readonly loads: ReadonlyArray<string>
    next: number
  }> = [{ path: world.path, loads: [], next: 0 }]
  state.set(world.path, 1)
  const visit = (specifier: string, from: string): boolean => {
    const one = loaded(specifier, from, world.read)
    if (one.kind === 'unknown') return false
    if (one.kind !== 'file') return true
    const path = one.file.path
    const seen = state.get(path)
    // A module on the walk's path again is a cycle.
    if (seen === 1) return false
    if (seen === 2) return true
    if (DATA.has(extensionOf(path))) {
      state.set(path, 2)
      return true
    }
    if (!CODE.includes(extensionOf(path))) return false
    size += one.file.text.length
    if (state.size >= MAX_MODULES || size > MAX_READ) return false
    const facts = moduleFacts(one.file.text, false)
    if (!facts.certain) return false
    state.set(path, 1)
    stack.push({ path, loads: facts.loads, next: 0 })
    return true
  }
  for (const root of roots) {
    if (!visit(root.specifier, root.from)) return false
    while (stack.length > 1) {
      const top = stack.at(-1)
      if (top === undefined) break
      const specifier = top.loads[top.next]
      if (specifier === undefined) {
        state.set(top.path, 2)
        stack.pop()
        continue
      }
      top.next += 1
      if (!visit(specifier, top.path)) return false
    }
  }
  return true
}

/** pytest's and unittest's hooks and options that change what a file's collection holds. */
const PYTHON_COLLECTION =
  /\bpytest_(?:pycollect_makeitem|pycollect_makemodule|collect_file|collect_directory|collection_modifyitems|itemcollected|make_collect_report|plugins)\b|\bpython_(?:functions|classes|files)\b|(?:^|\s)-p\s/
/** Python code that makes a test the reader cannot see: from a string, or bound by its name. */
const PYTHON_HIDDEN = /\b(?:exec|eval|setattr|load_tests)\s*\(|\bglobals\(\)|\bload_tests\b/
/** What a Python file imports: `from x import a, b as c`, parenthesised or not. */
const PYTHON_IMPORT =
  /^[ \t]*from[ \t]+(?<module>[\w.]+)[ \t]+import[ \t]+(?<names>\([^)]*\)|[^\n#]*)/gm
/** A name bound by assignment that pytest or unittest would collect. */
const PYTHON_TEST_ASSIGNED = /^[ \t]*(?:test\w*|Test\w*)[ \t]*(?::[^=\n]*)?=(?!=)/m

/** What in a Python module may be collected once a test file imports it: a test, a `TestCase`. */
const PYTHON_COLLECTED =
  /\bTestCase\b|\bunittest\b|^[ \t]*(?:async[ \t]+)?def[ \t]+test|^[ \t]*class[ \t]+Test/m

/**
 * The file of the repository a Python module names from a file, or null for a package: a relative
 * module from the file's folder, an absolute one from the root, `src`, or any folder above the
 * file (pytest puts the first folder with no `__init__.py` on the path).
 */
const pythonModule = (module: string, from: string, read: SourceWorld['read']): Found | null => {
  const dots = /^\.*/.exec(module)?.[0].length ?? 0
  const name = module.slice(dots).replaceAll('.', '/')
  const bases: string[] = []
  if (dots > 0) {
    let folder = folderOf(from)
    for (let up = 1; up < dots; up += 1) folder = folderOf(folder)
    bases.push(folder)
  } else {
    for (let folder = folderOf(from); folder !== ''; folder = folderOf(folder)) bases.push(folder)
    bases.push('src', '')
  }
  for (const base of bases) {
    const stem = [base, name].filter((one) => one !== '').join('/')
    for (const path of name === ''
      ? [`${stem}/__init__.py`]
      : [`${stem}.py`, `${stem}/__init__.py`]) {
      const text = read(path)
      if (text !== null) return { path, text }
    }
  }
  return null
}

/**
 * Whether the modules of the repository a Python file imports names from hold nothing a runner
 * collects: pytest and unittest collect a `TestCase` imported under any name. Each module is read
 * once, the modules it imports from too; a package is not read.
 */
const pythonImportsInert = (code: string, world: SourceWorld): boolean => {
  const seen = new Set<string>([world.path])
  const pending: Array<{ readonly code: string; readonly path: string }> = [
    { code, path: world.path },
  ]
  let size = 0
  for (let one = pending.pop(); one !== undefined; one = pending.pop()) {
    for (const found of one.code.matchAll(PYTHON_IMPORT)) {
      const module = pythonModule(found.groups?.['module'] ?? '', one.path, world.read)
      if (module === null || seen.has(module.path)) continue
      seen.add(module.path)
      size += module.text.length
      if (seen.size > MAX_MODULES || size > MAX_READ) return false
      if (PYTHON_COLLECTED.test(module.text) || PYTHON_HIDDEN.test(module.text)) return false
      pending.push({ code: module.text, path: module.path })
    }
  }
  return true
}

/**
 * Whether a Python test file is read in a closed world: none of its imports binds a name pytest
 * or unittest collects (`test…`, `Test…`, `*`) or a name the file declares (it would replace that
 * test), and no module of the repository it imports from holds a test or a `TestCase`; no test is bound by assignment, built from a string or set by name; no `conftest.py`
 * above it changes what is collected, nor a pytest configuration.
 */
export const pythonWorldCertain = (code: string, world: SourceWorld): boolean => {
  try {
    if (PYTHON_HIDDEN.test(code) || PYTHON_TEST_ASSIGNED.test(code)) return false
    const declared = new Set(
      Array.from(
        code.matchAll(/^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+(\w+)/gm),
        (found) => found[1],
      ),
    )
    for (const found of code.matchAll(PYTHON_IMPORT)) {
      const names = (found.groups?.['names'] ?? '').replace(/[()\\]/g, ' ').split(',')
      for (const name of names) {
        const bound =
          name
            .trim()
            .split(/\s+as\s+/)
            .at(-1)
            ?.trim() ?? ''
        if (bound === '*' || /^(?:test|Test)/.test(bound) || declared.has(bound)) return false
      }
    }
    if (!pythonImportsInert(code, world)) return false
    for (let folder = folderOf(world.path); ; folder = folderOf(folder)) {
      for (const name of ['conftest.py', 'pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']) {
        const text = world.read(folder === '' ? name : `${folder}/${name}`)
        if (text !== null && PYTHON_COLLECTION.test(text)) return false
      }
      if (folder === '') break
    }
    return true
  } catch {
    return false
  }
}
