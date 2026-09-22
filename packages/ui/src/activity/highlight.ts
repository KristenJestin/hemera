import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/**
 * What a diff is coloured with (design D17-13).
 *
 * A change is read either way; a change whose language is drawn is read faster, because a
 * keyword, a string and a comment stop looking alike. The language is the file's own — taken
 * from the extension of the path the agent reported — and never guessed: a file nothing here
 * knows is drawn plain, which is honest, where a guess would colour a shell script as C.
 *
 * The grammar is a dependency loaded when a diff of that language is first read, never before:
 * a session that touched one TypeScript file should not pay for twelve grammars. Nothing goes
 * over the network — the grammars, the engine and the theme are all in the bundle, and the
 * JavaScript engine is used precisely because it is the one that is not a WebAssembly fetch.
 *
 * The colours are not here. Shiki names a role per token and writes it as a variable —
 * `var(--shiki-token-keyword)` — and the role becomes a class whose colour `theme.css` decides,
 * where every other colour of the interface is decided. So this file knows a keyword when the
 * grammar says so, and knows nothing about what a keyword looks like.
 */

/** What the theme is called, which is how the highlighter is asked for it again. */
const THEME_NAME = 'css-variables'

/** The theme as the highlighter knows it: a name, and a variable per role. */
const THEME = createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--shiki-' })

const CLASS_OF = new Map<string, string>([
  ['foreground', 'text-inherit'],
  ['comment', 'tok-comment'],
  ['constant', 'tok-constant'],
  ['keyword', 'tok-keyword'],
  // A string and what is interpolated inside it are the same thing to a reader.
  ['string-expression', 'tok-string'],
  ['string', 'tok-string'],
  ['function', 'tok-function'],
  ['parameter', 'tok-parameter'],
  ['punctuation', 'tok-punctuation'],
  ['link', 'tok-link'],
])

const ROLE = /^var\(--shiki-(?:token-)?([a-z-]+)\)$/u

/** The class a token wears, or none when the theme said something this file has no role for. */
function classOf(colour: string | undefined): string {
  const role = colour === undefined ? undefined : ROLE.exec(colour)?.[1]
  return role === undefined ? '' : (CLASS_OF.get(role) ?? '')
}

/**
 * The languages a diff can arrive in, by the extension of the file. Everything else is drawn
 * plain, which is what this table is for: it is the list of grammars actually paid for.
 */
const LANGUAGES = new Map<string, string>([
  ['bash', 'shellscript'],
  ['cjs', 'javascript'],
  ['css', 'css'],
  ['cts', 'typescript'],
  ['html', 'html'],
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['jsx', 'jsx'],
  ['markdown', 'markdown'],
  ['md', 'markdown'],
  ['mjs', 'javascript'],
  ['mts', 'typescript'],
  ['py', 'python'],
  ['python', 'python'],
  ['sh', 'shellscript'],
  ['ts', 'typescript'],
  ['tsx', 'tsx'],
  ['toml', 'toml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['zsh', 'shellscript'],
])

/** The grammar of each language, as the import that brings it. */
const GRAMMARS = new Map<string, () => Promise<{ default: LanguageRegistration[] }>>([
  ['css', () => import('shiki/langs/css.mjs')],
  ['html', () => import('shiki/langs/html.mjs')],
  ['javascript', () => import('shiki/langs/javascript.mjs')],
  ['json', () => import('shiki/langs/json.mjs')],
  ['jsx', () => import('shiki/langs/jsx.mjs')],
  ['markdown', () => import('shiki/langs/markdown.mjs')],
  ['python', () => import('shiki/langs/python.mjs')],
  ['shellscript', () => import('shiki/langs/shellscript.mjs')],
  ['toml', () => import('shiki/langs/toml.mjs')],
  ['tsx', () => import('shiki/langs/tsx.mjs')],
  ['typescript', () => import('shiki/langs/typescript.mjs')],
  ['yaml', () => import('shiki/langs/yaml.mjs')],
])

/** One token: its text, and the class its role wears. */
export interface HighlightedToken {
  text: string
  className: string
}

/** One line of a diff, as the tokens the grammar found in it. */
export type HighlightedLine = HighlightedToken[]

/** What was already drawn, so that a re-render reads the same answer and not a new one. */
const DRAWN = new Map<string, HighlightedLine[] | null>()

/**
 * How many drawn changes are held.
 *
 * The cache exists so that a re-render reads the same array and not a new one, which is a
 * question about the diffs on screen and not about every diff of a day's work: a window left
 * open would otherwise hold the text of every file a session ever touched, twice — once as the
 * source and once as its tokens.
 */
const DRAWN_KEPT = 64
const LOADED = new Set<string>()
const LISTENERS = new Set<() => void>()

let made: Promise<HighlighterCore> | null = null
let ready: HighlighterCore | null = null

/**
 * The one highlighter of the application, made on first use. It holds no grammar of its own:
 * each is loaded on demand by `warm`, and the engine is the JavaScript one, which is a regular
 * expression engine in the bundle rather than a WebAssembly module to fetch.
 */
function highlighter(): Promise<HighlighterCore> {
  made ??= createHighlighterCore({
    themes: [THEME],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).then((instance) => {
    ready = instance
    return instance
  })
  return made
}

/** The language of a file, or null when its extension is one nobody here colours. */
export function languageOf(path: string): string | null {
  const name = path.split(/[\\/]/u).pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return LANGUAGES.get(name.slice(dot + 1).toLowerCase()) ?? null
}

/** Asks for the grammar of a language, once, and wakes whoever waits for it. */
export async function warm(language: string | null): Promise<void> {
  if (language === null || LOADED.has(language)) return
  const grammar = GRAMMARS.get(language)
  if (grammar === undefined) return
  const instance = await highlighter()
  await instance.loadLanguage(grammar())
  LOADED.add(language)
  for (const listener of LISTENERS) listener()
}

/** Watches for a grammar arriving; returns what undoes the watching. */
export function subscribeToHighlight(listener: () => void): () => void {
  LISTENERS.add(listener)
  return () => {
    LISTENERS.delete(listener)
  }
}

/**
 * The code as the lines of tokens the grammar found, or null while its grammar is still coming —
 * and null for good for a language nobody here colours, which the caller draws plain.
 */
export function highlighted(code: string, language: string | null): HighlightedLine[] | null {
  if (language === null || !LOADED.has(language) || ready === null) return null
  const key = `${language}\u0000${code}`
  if (DRAWN.has(key)) return DRAWN.get(key) ?? null
  const drawn = draw(ready, code, language)
  DRAWN.set(key, drawn)
  // The oldest go first, which is the diff furthest up a thread nobody is scrolled to: drawing
  // it again is one pass of the grammar, where holding it is the whole file for as long as the
  // window is open.
  while (DRAWN.size > DRAWN_KEPT) {
    const oldest = DRAWN.keys().next()
    if (oldest.done === true) break
    DRAWN.delete(oldest.value)
  }
  return drawn
}

function draw(instance: HighlighterCore, code: string, language: string): HighlightedLine[] | null {
  try {
    const { tokens } = instance.codeToTokens(code, { lang: language, theme: THEME_NAME })
    return tokens.map((line) =>
      line.map((token) => ({ text: token.content, className: classOf(token.color) })),
    )
  } catch {
    // A grammar that refuses a piece of code is not a reason to lose the change: it is drawn
    // plain, which is what every other unreadable file gets.
    return null
  }
}
