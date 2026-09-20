import type { ReactNode } from 'react'

import { FileChip, named } from '../composer/file-chip.tsx'

/**
 * What a message says, with the files it named drawn as the box drew them (design D4-07).
 *
 * A mention is how a file is named in a sentence, and a file named in the thread is the one the
 * box left there: the same chip, in the tone of what naming it did. What was written and what is
 * then read are one thing — the reading itself lives beside the spelling, in `file-chip.tsx` — and
 * a message that turned `@sources/core.md` back into characters would ask the eye to parse a word
 * it had already been taught to recognise.
 *
 * The kind is in the words, because the words are the only thing that carries it: a file *handed
 * over* — picked with the paperclip, from the Project or from anywhere else — is written
 * `@"path"`, and the double quote is what says so. A thread that drew both as an `@` named a file
 * the reader never pointed at, which is how an attachment came out looking like a link.
 */
export function MessageText({ body }: { body: string }): ReactNode {
  return (
    <>
      {named(body).map((piece, at) =>
        piece.at === 'words' ? (
          piece.said
        ) : (
          <FileChip key={`${at}-${piece.path}`} path={piece.path} kind={piece.kind} />
        ),
      )}
    </>
  )
}
