import type { ReactNode } from 'react'
import { IconFileText, IconListCheck, IconTerminal } from '../../icons.ts'
import { fuzzyScore } from './fuzzy.ts'

/**
 * What the mention field is made of besides its editor: its props, its box and foot, its badge,
 * and its search. Nothing here loads Tiptap, so a message in a thread can wear a badge and a page
 * can draw the field's shape without the editor's weight.
 */

export type MentionKind = 'file' | 'mission' | 'command'

export interface Mentionable {
  kind: MentionKind
  id: string
  /** What the mention stands for: a path, a mission's key, a command's name. */
  label: string
  /** What it is, in a quiet line: a mission's title, a command's line. */
  detail?: string | undefined
  /** Its rank among the recent ones, 1 the latest; left out when it is not recent. */
  recent?: number | undefined
}

/** A mention as the field keeps it beside the text: what it is, which one, and its label. */
export interface MentionRef {
  kind: MentionKind
  id: string
  label: string
}

/** How many entries the menu lists at most. */
const SHOWN = 50

export const GLYPHS: Record<MentionKind, ReactNode> = {
  file: <IconFileText size="sm" />,
  mission: <IconListCheck size="sm" />,
  command: <IconTerminal size="sm" />,
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** What a badge shows: a file's name, anything else whole. */
export const shortName = (kind: MentionKind, label: string): string =>
  kind === 'file' ? baseName(label) : label

/** A search in a path counts most in its file name, then in the path, then in the detail. */
function scoreOf(item: Mentionable, query: string): number | null {
  const whole = fuzzyScore(item.label, query)
  const name = item.kind === 'file' ? fuzzyScore(baseName(item.label), query) : null
  const detail = item.detail === undefined ? null : fuzzyScore(item.detail, query)
  const found = [
    whole,
    name === null ? null : name + 5,
    detail === null ? null : detail - 5,
  ].filter((score) => score !== null)
  return found.length === 0 ? null : Math.max(...found)
}

const recency = (item: Mentionable): number => item.recent ?? Number.POSITIVE_INFINITY

export function mentionsFor(
  mentionables: readonly Mentionable[],
  query: string,
): readonly Mentionable[] {
  if (query === '') {
    return mentionables.toSorted((a, b) => recency(a) - recency(b)).slice(0, SHOWN)
  }
  return mentionables
    .map((item) => ({ item, score: scoreOf(item, query) }))
    .filter((one): one is { item: Mentionable; score: number } => one.score !== null)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        recency(a.item) - recency(b.item) ||
        a.item.label.length - b.item.label.length,
    )
    .map((one) => one.item)
    .slice(0, SHOWN)
}

export const KINDS: readonly MentionKind[] = ['file', 'mission', 'command']

/** What a written `@label` most likely is, with nothing else to go on: a key, a path, a name. */
export function kindOf(label: string): MentionKind {
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(label)) return 'mission'
  return label.includes('/') || label.includes('.') ? 'file' : 'command'
}
