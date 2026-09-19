/**
 * What a form of this application accepts, said once (design D4-03, D4-07).
 *
 * These are the rules a field can check on its own, before anything is asked of anybody: a name
 * that is empty or longer than a document, a path that is absolute or climbs out of its root.
 * They are not the domain's rules restated — the domain still refuses what it refuses and what
 * it says is still shown — they are the same rules said early enough that the user is not made
 * to press a button to find out.
 *
 * Whether a folder is *there* is not here: only a disk can answer that, and the field asks for
 * it with a validator of its own.
 */

import { z } from 'zod'

/** As long as a name is allowed to be, which is where a name stops being one. */
export const NAME_LIMIT = 120

/**
 * None of these trims, and that is on purpose.
 *
 * A schema that trims is a schema that *transforms*, and a form validated by one hands the
 * transformed value back to the field: the space someone typed in the middle of naming a
 * Project would disappear from under their caret. What is checked here is the trimmed value;
 * what is kept is what was typed, and the domain trims it when it writes it down.
 */
const filled = (candidate: string): boolean => candidate.trim() !== ''

export const nameSchema = z
  .string()
  .refine(filled, 'A Project needs a name.')
  .refine(
    (name) => name.trim().length <= NAME_LIMIT,
    `A name stops at ${String(NAME_LIMIT)} characters.`,
  )

export const tonesSchema = z.enum(['primary', 'info', 'success', 'warning', 'neutral'])

export const folderSchema = z.string().refine(filled, 'Say which folder holds its sources.')

/**
 * A location of a Project, relative to the root of its Workspace.
 *
 * The same three refusals the domain makes, said here so the field can say them while the path
 * is still being typed. The domain remains the authority: this is the early word, not the last.
 */
export const relativePathSchema = z
  .string()
  .refine(filled, 'Say which folder to declare.')
  .refine(
    (path) => !path.trim().startsWith('/') && !/^[a-zA-Z]:/.test(path.trim()),
    'That path is absolute.',
  )
  .refine((path) => !climbsOut(path.trim()), 'That path climbs out of the Workspace.')

function climbsOut(candidate: string): boolean {
  let depth = 0
  for (const segment of candidate.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (depth === 0) return true
      depth -= 1
      continue
    }
    depth += 1
  }
  return false
}

/** What the creation dialog and the identity of the settings both hold. */
export const projectFormSchema = z.object({
  name: nameSchema,
  tone: tonesSchema,
  mainPath: folderSchema,
})
