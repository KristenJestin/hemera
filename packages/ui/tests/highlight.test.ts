/**
 * What a diff is coloured with (design D17-13), read from the module that does the colouring.
 *
 * The component around it is a browser story; what can be proved without a browser is the part
 * that decides: which language a path is, that a grammar really colours the code of that
 * language, that a draw the grammar never read is drawn again rather than kept, that a file
 * nobody knows is drawn plain, and that none of it leaves the machine.
 */

import { describe, expect, test, vi } from 'vite-plus/test'

import {
  highlighted,
  languageOf,
  subscribeToHighlight,
  warm,
  type HighlightedLine,
} from '../src/activity/highlight.ts'

const TYPESCRIPT = 'const answer: number = 42\n// the end\n'
const CSS = 'a { color: red; }\n'

/** Every token of every line, so a suite can ask what the grammar found. */
function tokens(lines: HighlightedLine[] | null): string[] {
  return lines === null
    ? []
    : lines.flatMap((line) => line.map((token) => `${token.className}:${token.text}`))
}

/**
 * The tokens of a code, read the way a reader reads them: `highlighted` answers nothing while it
 * has nothing to keep, and the module wakes its readers to draw the same code again — the draw
 * that reads a grammar which had not read yet.
 */
async function coloured(code: string, language: string): Promise<string[]> {
  const first = highlighted(code, language)
  if (first !== null) return tokens(first)
  const woken = new Promise<void>((resolve) => {
    const stop = subscribeToHighlight(() => {
      stop()
      resolve()
    })
  })
  await woken
  return tokens(highlighted(code, language))
}

/** Lets the task the module woke its readers on run. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * A clock that runs out on the time shiki allows a line, which is what a machine busy with the
 * rest of the run does to the draw that first compiles a grammar: the line comes back as one
 * token the grammar never looked at. Returns what stops the pretending.
 */
function busyClock(): () => void {
  const real = Date.now
  let ticks = 0
  const busy = vi.spyOn(Date, 'now').mockImplementation(() => real() + (ticks += 10_000))
  return () => {
    busy.mockRestore()
  }
}

describe('the language of a diff', () => {
  test('a diff in the language of the file it came from', async () => {
    expect(languageOf('packages/ui/src/activity/highlight.ts')).toBe('typescript')
    expect(languageOf('/work/repos/hemera/apps/desktop/src/main/index.tsx')).toBe('tsx')
    // Windows paths arrive too, from an agent running on the machine that runs the application.
    expect(languageOf('D:\\Projects\\hemera\\tools\\boundaries.ts')).toBe('typescript')
  })

  test('a file with no extension is not guessed at', () => {
    expect(languageOf('Makefile')).toBeNull()
    expect(languageOf('android/app/proguard-rules')).toBeNull()
    expect(languageOf('/home/kris/.gitignore')).toBeNull()
    expect(languageOf('docs/METHOD.md')).toBe('markdown')
  })

  test('a grammar that has not arrived yet colours nothing, and says so', () => {
    expect(highlighted(TYPESCRIPT, 'typescript')).toBeNull()
  })

  test('a TypeScript diff is coloured, and its keywords are the keywords', async () => {
    await warm('typescript')
    // Twenty codes, drawn together: the draw that first uses a grammar is the draw that compiles
    // its rules, and the one a machine busy with the rest of the run can lose — a case that passes
    // once and fails on the twentieth run is the case this file is here for.
    const rounds = await Promise.all(
      Array.from({ length: 20 }, (_, round) =>
        coloured(`${TYPESCRIPT}// round ${round}\n`, 'typescript'),
      ),
    )
    for (const [round, drawn] of rounds.entries()) {
      expect(drawn.join(''), `round ${round} lost the code`).toContain('const')
      expect(drawn, `round ${round} came back plain`).toContain('tok-keyword:const')
      expect(drawn, `round ${round} lost the comment`).toContain('tok-comment:// the end')
    }
  })

  test('the same code in another language is coloured by that language', async () => {
    await warm('css')
    await warm('typescript')
    // The same rule in twenty rounds, each with a comment of its own in it, so that every round is
    // a draw and not the answer the round before it left in the cache.
    const rounds = await Promise.all(
      Array.from({ length: 20 }, (_, round) => {
        const code = `${CSS.trimEnd()} /* round ${round} */\n`
        return Promise.all([coloured(code, 'css'), coloured(code, 'typescript')])
      }),
    )
    for (const [round, [asCss, asTypeScript]] of rounds.entries()) {
      // The grammar cut it up, something in it was coloured, and the same text read as another
      // language comes out differently: which token a colour name lands in is the grammar's
      // business, and this suite is not the place to pin a version of one.
      expect(asCss.length, `round ${round} was not cut up`).toBeGreaterThan(1)
      expect(
        asCss.some((token) => token.startsWith('tok-')),
        `round ${round} was not coloured`,
      ).toBe(true)
      expect(asCss, `round ${round} read the same in both languages`).not.toEqual(asTypeScript)
    }
  })

  test('a grammar is reported loaded only once it tokenizes', async () => {
    await warm('typescript')
    // `loadLanguage` resolving is not the grammar reading: the draw that first uses a grammar is
    // the draw that compiles its rules, and one that runs out of the time shiki allows a line comes
    // back as one token the grammar never looked at — which is what a machine busy with the rest of
    // the run produces, and what the clock here produces on purpose. Such a draw is not an answer:
    // nothing is kept, and the readers are woken to draw the same code again, which is the draw
    // that reads.
    const onceMore = `${TYPESCRIPT}// once more\n`
    const woken = new Promise<void>((resolve) => {
      const stop = subscribeToHighlight(() => {
        stop()
        resolve()
      })
    })
    const busy = busyClock()
    expect(highlighted(onceMore, 'typescript')).toBeNull()
    busy()
    await woken
    expect(tokens(highlighted(onceMore, 'typescript'))).toContain('tok-keyword:const')
  })

  test('a draw that found nothing is given one second chance, and no more', async () => {
    await warm('css')
    // The same clock, on a code no other case here has drawn: the draw comes back plain, the
    // readers are woken once, and the code drawn again is kept whatever it says. Once, because a
    // change with nothing to colour is a plain change, and a language that asked for ever would
    // spin.
    const code = `${CSS.trimEnd()} /* once */\n`
    let wakes = 0
    const stop = subscribeToHighlight(() => {
      wakes += 1
    })
    const busy = busyClock()
    expect(highlighted(code, 'css')).toBeNull()
    busy()
    await nextTask()
    expect(highlighted(code, 'css')).not.toBeNull()
    await nextTask()
    stop()
    expect(wakes).toBe(1)
  })

  test('a language nobody here colours is left plain, not coloured by a guess', () => {
    expect(warm('plaintext')).toBeInstanceOf(Promise)
    expect(highlighted('<?xml version="1.0"?>', null)).toBeNull()
  })

  test('nothing is fetched: the grammars and the theme come with the application', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'))
    await warm('json')
    expect(highlighted('{ "a": 1 }', 'json')).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('a reader waiting is woken when the grammar arrives', async () => {
    const woken = vi.fn()
    const stop = subscribeToHighlight(woken)
    await warm('yaml')
    stop()
    expect(woken).toHaveBeenCalled()
  })
})
