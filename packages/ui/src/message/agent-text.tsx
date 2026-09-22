import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming'
import { Markdown, type MarkdownComponentProps } from '@tanstack/markdown/react'
import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * What an agent said, drawn from the text that is still arriving (design D5-14).
 *
 * An agent answers in Markdown and answers while writing: the text of a line grows by a few
 * characters at a time, and what is on screen halfway through is not a shorter answer but the
 * beginning of one. So the whole of what has arrived is reparsed on every render — this side
 * keeps no tree and patches nothing — and the states a text is in on its way are ordinary
 * states rather than errors: a fence that has been opened and not closed, an emphasis with one
 * of its two stars, a list whose last item is a line still being written. The streaming profile
 * is what keeps the last of those out of the reader's way, by dropping the empty heading or list
 * item an agent produces when it has typed a marker and nothing after it yet — which would
 * otherwise be a blank line in the middle of a sentence (agent-session-ui-2026-09.md §5).
 *
 * The elements are dressed here and not in the theme, because a heading inside an answer is one
 * step below a page's own: a reply is not a document, and that is a decision about this component
 * rather than about the design system. No colour is named either, and no width: a fence is the
 * theme's own muted surface, and an answer is read in the bubble the thread gave it.
 */
export function AgentText({ text }: { text: string }): ReactNode {
  return (
    <div className={ANSWER}>
      <Markdown components={COMPONENTS} extensions={STREAMING}>
        {text}
      </Markdown>
    </div>
  )
}

/** The schemes an address in an answer may carry; every other one is not an address. */
const FOLLOWABLE = new Set(['http:', 'https:', 'mailto:'])

/** The address of a link when it is one of those, and nothing at all when it is not. */
function followable(href: string | undefined): string | undefined {
  if (href === undefined) return undefined
  try {
    // The base is what makes a relative address readable; it never reaches the element.
    return FOLLOWABLE.has(new URL(href, 'https://localhost/').protocol) ? href : undefined
  } catch {
    return undefined
  }
}

/**
 * The streaming profile, made once.
 *
 * It holds nothing: it trims a trailing empty heading or list item from the document it is given,
 * and hands the document back untouched when there is nothing to trim. A new one per render would
 * be a new array and a new object around a function that never changes.
 */
const STREAMING = [streamingMarkdownExtension()]

/**
 * What an answer is, before anything inside it is dressed.
 *
 * The line breaks of the thread are given up here, on purpose. A message keeps them, because
 * Shift+Enter is how a paragraph is written in the box, and a thread that collapsed them would
 * read back a message nobody wrote. In Markdown a single newline is a space, and the parser has
 * already decided where the blocks are — drawing the source's breaks on top of that would break
 * a sentence the parser had joined, which is the one thing an answer would then be wrong about.
 */
const ANSWER = 'min-w-0 whitespace-normal text-base'

/**
 * The gap between two blocks of an answer, and the absence of one at either end.
 *
 * A bubble already carries its own padding, so the first block and the last one sit against it
 * rather than away from it; the rhythm of the answer is the whole of what is left to decide.
 */
const BLOCK = 'my-3 first:mt-0 last:mb-0'

/**
 * The elements an answer can be made of, dressed one by one.
 *
 * A table rather than a stylesheet of the catalogue, because these elements are made by a parser
 * and not by us: what is written here is the whole of what an agent can emit, and one place to
 * read it is worth the twelve lines. Every entry keeps the class the parser put on the element —
 * a fence is `language-ts` before it is anything of ours — and adds to it, so a highlighter can
 * be hooked on later without this file having to be found again.
 *
 * Headings are the one place the design system is departed from: a page's `h1` is a page's, and
 * the heading of a reply is a step below the page it is read on. Sizes come from the theme's own
 * text scale, never from a number written here.
 */
const COMPONENTS = {
  h1: ({ className, ...rest }: MarkdownComponentProps<'h1'>) => (
    <h1 className={cn('mt-5 mb-2 text-xl font-medium first:mt-0', className)} {...rest} />
  ),
  h2: ({ className, ...rest }: MarkdownComponentProps<'h2'>) => (
    <h2 className={cn('mt-5 mb-2 text-lg font-medium first:mt-0', className)} {...rest} />
  ),
  h3: ({ className, ...rest }: MarkdownComponentProps<'h3'>) => (
    <h3 className={cn('mt-4 mb-2 text-base font-medium first:mt-0', className)} {...rest} />
  ),
  h4: ({ className, ...rest }: MarkdownComponentProps<'h4'>) => (
    <h4
      className={cn('mt-3 mb-2 text-sm font-medium text-muted-foreground first:mt-0', className)}
      {...rest}
    />
  ),
  h5: ({ className, ...rest }: MarkdownComponentProps<'h5'>) => (
    <h5
      className={cn('mt-3 mb-2 text-sm font-medium text-muted-foreground first:mt-0', className)}
      {...rest}
    />
  ),
  h6: ({ className, ...rest }: MarkdownComponentProps<'h6'>) => (
    <h6
      className={cn('mt-3 mb-2 text-sm font-medium text-muted-foreground first:mt-0', className)}
      {...rest}
    />
  ),
  p: ({ className, ...rest }: MarkdownComponentProps<'p'>) => (
    <p className={cn(BLOCK, className)} {...rest} />
  ),
  ul: ({ className, ...rest }: MarkdownComponentProps<'ul'>) => (
    <ul className={cn(`${BLOCK} ml-5 list-disc space-y-1`, className)} {...rest} />
  ),
  ol: ({ className, ...rest }: MarkdownComponentProps<'ol'>) => (
    <ol className={cn(`${BLOCK} ml-5 list-decimal space-y-1`, className)} {...rest} />
  ),
  li: ({ className, ...rest }: MarkdownComponentProps<'li'>) => (
    <li className={cn('my-0.5', className)} {...rest} />
  ),
  blockquote: ({ className, ...rest }: MarkdownComponentProps<'blockquote'>) => (
    <blockquote
      className={cn(`${BLOCK} border-l-2 border-border pl-3 text-muted-foreground`, className)}
      {...rest}
    />
  ),
  /**
   * A link is drawn and not followed: the address arrives as the agent wrote it, and a press on
   * it belongs to the window — an answer never navigates the page it is being read on.
   *
   * The address the agent wrote is also a thing the agent wrote: a `javascript:` one is a press
   * that runs the agent's own code in the window, so what is not one of the three schemes below
   * is drawn as the text it is and carries no address at all.
   */
  a: ({ className, href, ...rest }: MarkdownComponentProps<'a'>) => (
    <a
      className={cn('text-primary underline underline-offset-2', className)}
      href={followable(href)}
      {...rest}
    />
  ),
  /**
   * Code in two shapes, told apart by the class the parser puts on the fence's own element: a
   * fence is a surface of the theme, and a word of code inside a sentence is not.
   */
  code: ({ className, ...rest }: MarkdownComponentProps<'code'>) => (
    <code
      className={cn(
        'font-mono text-sm',
        className?.startsWith('language-') === true ? undefined : 'rounded-sm bg-muted px-1 py-0.5',
        className,
      )}
      {...rest}
    />
  ),
  /**
   * A fence scrolls rather than wraps: code that has been broken to fit a bubble is code whose
   * lines no longer say what they said, and an answer is read for what it says.
   */
  pre: ({ className, ...rest }: MarkdownComponentProps<'pre'>) => (
    <pre
      className={cn(
        `${BLOCK} overflow-x-auto rounded-lg border border-border bg-muted p-3`,
        className,
      )}
      {...rest}
    />
  ),
  hr: ({ className, ...rest }: MarkdownComponentProps<'hr'>) => (
    <hr className={cn('my-4 border-t border-border', className)} {...rest} />
  ),
  table: ({ className, ...rest }: MarkdownComponentProps<'table'>) => (
    <div className={BLOCK}>
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse text-sm', className)} {...rest} />
      </div>
    </div>
  ),
  th: ({ className, ...rest }: MarkdownComponentProps<'th'>) => (
    <th
      className={cn('border border-border px-2 py-1 text-left font-medium', className)}
      {...rest}
    />
  ),
  td: ({ className, ...rest }: MarkdownComponentProps<'td'>) => (
    <td className={cn('border border-border px-2 py-1', className)} {...rest} />
  ),
}
