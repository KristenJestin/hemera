/**
 * What a diff is coloured with (design D17-13), read from the module that does the colouring.
 *
 * The component around it is a browser story; what can be proved without a browser is the part
 * that decides: which language a path is, that a grammar really colours the code of that
 * language — every line of it, even on a machine too busy to read a line in half a second — that
 * a file nobody knows is drawn plain, and that none of it leaves the machine.
 */

import { describe, expect, test, vi } from 'vite-plus/test'

import {
  highlighted,
  languageOf,
  loaded,
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

/** The tokens of each line on its own, so a suite can ask what became of one line. */
function tokensByLine(lines: HighlightedLine[] | null): string[][] {
  return (lines ?? []).map((line) => line.map((token) => `${token.className}:${token.text}`))
}

/**
 * Reads something while the machine stalls once, for two seconds, inside the first line read:
 * what a machine busy with the rest of the run does to the line that compiles a grammar's rules.
 * Shiki times each line on its own and gives up on one after half a second, so only that line
 * is late — the lines after it are timed from their own start. The first reading of the clock is
 * when the line starts, the second is its first look at the time, and the stall lands between.
 * The clock is the machine's own again afterwards, whatever the reading did.
 */
function stalledOnce<T>(read: () => T): T {
  const real = Date.now
  let readings = 0
  const clock = vi
    .spyOn(Date, 'now')
    .mockImplementation(() => real() + ((readings += 1) >= 2 ? 2_000 : 0))
  try {
    return read()
  } finally {
    clock.mockRestore()
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
    // Twenty codes, each a draw of its own: a case that passes once and fails on the twentieth
    // run is the case this file is here for.
    for (let round = 0; round < 20; round += 1) {
      const drawn = tokens(highlighted(`${TYPESCRIPT}// round ${round}\n`, 'typescript'))
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
    for (let round = 0; round < 20; round += 1) {
      const code = `${CSS.trimEnd()} /* round ${round} */\n`
      const asCss = tokens(highlighted(code, 'css'))
      const asTypeScript = tokens(highlighted(code, 'typescript'))
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
    // A grammar no other case here draws, so that the draw below is the one that compiles its
    // rules — the draw #51 lost on a busy machine, and kept, uncoloured, for good.
    const code = 'def answer():\n    return 42  # the end\n'
    const loading = warm('python')
    expect(loaded('python')).toBe(false)
    expect(highlighted(code, 'python')).toBeNull()
    await loading
    expect(loaded('python')).toBe(true)
    const lines = tokensByLine(stalledOnce(() => highlighted(code, 'python')))
    expect(lines[0], 'the line that compiled the grammar came back plain').toContain(
      'tok-keyword:def',
    )
    expect(lines[1], 'the line after it came back plain').toContain('tok-comment:# the end')
  })

  test('a line the machine stalls on is still read to its end, and so is every other', async () => {
    await warm('typescript')
    // The shape #51 reported: the first line late, the rest on time. The late line is the one
    // that matters, because the draw it belongs to is kept.
    const code = `${TYPESCRIPT}// stalled\n`
    const drawn = stalledOnce(() => highlighted(code, 'typescript'))
    const [first, second, third] = tokensByLine(drawn)
    expect(first, 'the stalled line came back plain').toContain('tok-keyword:const')
    expect(first, 'the stalled line came back as one token').not.toContain(
      'text-inherit:const answer: number = 42',
    )
    expect(second).toContain('tok-comment:// the end')
    expect(third).toContain('tok-comment:// stalled')
    // What is kept is that same coloured draw, read again on the machine's own clock.
    expect(highlighted(code, 'typescript')).toBe(drawn)
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
