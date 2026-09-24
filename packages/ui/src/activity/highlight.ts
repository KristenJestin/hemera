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

/** The class of a token nothing coloured: the text's own colour, which a plain line wears. */
const PLAIN = 'text-inherit'

const CLASS_OF = new Map<string, string>([
  ['foreground', PLAIN],
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

/** The languages whose grammar is in hand: `warm` has brought it and its rules are registered. */
const ARRIVED = new Set<string>()
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
/** The draws already given their one second chance, by language and code: one, never a loop. */
const RETRIED = new Set<string>()
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

/**
 * Asks for the grammar of a language, once, and wakes whoever waits for it.
 *
 * A registered grammar is not a grammar that reads: the draw that first uses one is the draw that
 * compiles its rules, and a machine busy with the rest of the run can lose that draw to the time
 * shiki allows a line. So nothing here says that a language is loaded — what wakes is the grammar
 * being there, and `highlighted` is what decides whether a draw is an answer.
 */
export async function warm(language: string | null): Promise<void> {
  if (language === null || ARRIVED.has(language)) return
  const grammar = GRAMMARS.get(language)
  if (grammar === undefined) return
  const instance = await highlighter()
  await instance.loadLanguage(grammar())
  ARRIVED.add(language)
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
 * The code as the lines of tokens the grammar found, or null while there is nothing to draw with —
 * and null for good for a language nobody here colours, which the caller draws plain.
 *
 * Null does not only mean that the grammar is still coming. Shiki hands back a line it could not
 * tokenize in the time it allows as one token the grammar never looked at, and the draw that first
 * uses a grammar — the one that compiles its rules — is the draw a busy machine can lose that way.
 * A draw that found nothing the theme knows is therefore not an answer: nothing is kept, and the
 * readers are woken once more so that the same code is drawn again, which is the draw that reads.
 * Once, because a change with nothing to colour is a plain change, and asking for ever would spin.
 */
export function highlighted(code: string, language: string | null): HighlightedLine[] | null {
  if (language === null || !ARRIVED.has(language) || ready === null) return null
  const key = `${language}\u0000${code}`
  const kept = DRAWN.get(key)
  if (kept !== undefined) return kept
  const drawn = draw(ready, code, language)
  if (drawn !== null && !tokenized(drawn) && !RETRIED.has(key)) {
    RETRIED.add(key)
    // A task of its own, because `highlighted` is read while a frame is being built, and waking
    // the readers from inside one is not something React takes.
    setTimeout(() => {
      for (const listener of LISTENERS) listener()
    }, 0)
    return null
  }
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

/**
 * Whether a draw is a tokenization. A line the grammar never looked at comes back as one token
 * wearing the theme's own foreground — the colour the text already has — and a role this file has
 * no class for wears none at all, so neither of those is what a colour looks like.
 */
function tokenized(lines: HighlightedLine[]): boolean {
  return lines.some((line) =>
    line.some((token) => token.className !== '' && token.className !== PLAIN),
  )
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
