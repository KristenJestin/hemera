/**
 * Hemera's instructions keep, in their text, the place where what every session of a role shares
 * ends and what belongs to the session begins. Claude Code cuts them there into blocks; every
 * other reader takes them as one text.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  SYSTEM_PROMPT_BOUNDARY,
  promptBlocks,
  promptText,
} from '../src/engine/agents/prompt-blocks.ts'

const KEPT = `Shared.\n\n---\n\nRole.\n\n${SYSTEM_PROMPT_BOUNDARY}\n\nSession.\n\n---\n\nProject.`

describe('The cache boundary in kept instructions', () => {
  test('it is the marker the Agent SDK reads', () => {
    expect(SYSTEM_PROMPT_BOUNDARY).toBe('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__')
  })

  test('Claude Code gets the shared blocks, the marker on its own, then the session’s blocks', () => {
    expect(promptBlocks(KEPT)).toEqual([
      'Shared.\n\n---\n\nRole.',
      SYSTEM_PROMPT_BOUNDARY,
      'Session.\n\n---\n\nProject.',
    ])
  })

  test('a text with no boundary stays the one text it was', () => {
    expect(promptBlocks('Written before the boundary existed.')).toBe(
      'Written before the boundary existed.',
    )
  })

  test('every other reader gets one text, the boundary a layer break', () => {
    expect(promptText(KEPT)).toBe('Shared.\n\n---\n\nRole.\n\n---\n\nSession.\n\n---\n\nProject.')
    expect(promptText('No boundary.')).toBe('No boundary.')
  })

  test('only the first boundary cuts: a marker inside the session’s part is text', () => {
    const text = `Shared.\n\n${SYSTEM_PROMPT_BOUNDARY}\n\nA file that quotes\n\n${SYSTEM_PROMPT_BOUNDARY}\n\nthe marker.`
    expect(promptBlocks(text)).toEqual([
      'Shared.',
      SYSTEM_PROMPT_BOUNDARY,
      `A file that quotes\n\n${SYSTEM_PROMPT_BOUNDARY}\n\nthe marker.`,
    ])
  })
})
