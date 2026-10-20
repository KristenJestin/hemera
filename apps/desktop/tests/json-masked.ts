/**
 * What the suites of #397 hand the engine and look for in what it stored: a credential whose
 * value is quoted (`password="a b"`), and a known value, both inside a JSON string once the
 * engine serializes them. Masked as plain text, the quoted value leaked and the JSON broke
 * (`["password=•••"a b\""]`).
 */

import { expect } from 'vite-plus/test'

/** A labelled credential whose value is quoted, as an agent may write it. */
export const QUOTED_SECRET = 'password="a b"'

/** A value the registry knows as secret. */
export const KNOWN_SECRET = 'sesame-4417'

/** Checks that a stored text holds nothing of either secret and is still JSON. */
export const expectMaskedJson = (stored: string | null | undefined) => {
  expect(stored).toBeTypeOf('string')
  expect(() => JSON.parse(stored ?? '')).not.toThrow()
  expect(stored).not.toContain('a b')
  expect(stored).not.toContain(KNOWN_SECRET)
  expect(stored).toContain('•••')
}
