/**
 * What a diff is coloured with (design D17-13), read from the module that does the colouring.
 *
 * The component around it is a browser story; what can be proved without a browser is the part
 * that decides: which language a path is, that a grammar really colours the code of that
 * language, that a file nobody knows is drawn plain, and that none of it leaves the machine.
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
    const drawn = highlighted(TYPESCRIPT, 'typescript')
    expect(drawn).not.toBeNull()
    expect(tokens(drawn).join('')).toContain('const')
    expect(tokens(drawn)).toContain('tok-keyword:const')
    expect(tokens(drawn)).toContain('tok-comment:// the end')
  })

  test('the same code in another language is coloured by that language', async () => {
    await warm('css')
    const drawn = highlighted(CSS, 'css')
    expect(tokens(drawn)).toContain('tok-constant:red')
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
