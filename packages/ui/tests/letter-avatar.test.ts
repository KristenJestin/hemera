/**
 * What a letter avatar says: the first letter of a name, two letters when first letters collide
 * in the same set, and a colour of its own read from the name, so it never changes as others come
 * and go. The avatar itself is a story; what is proved here is the part that chooses.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  LETTER_TONES,
  initialsOf,
  letterToneOf,
} from '../src/components/letter-avatar/letter-avatar.tsx'

describe('The letters of an avatar', () => {
  test('a name alone with its first letter wears that letter, in capitals', () => {
    expect(initialsOf('reviewer', [])).toBe('R')
    expect(initialsOf('Reviewer', ['Documenter', 'Planner'])).toBe('R')
  })

  test('two names that share a first letter wear two letters each', () => {
    expect(initialsOf('Reviewer', ['Documenter', 'Rover'])).toBe('RE')
    expect(initialsOf('Rover', ['Reviewer'])).toBe('RO')
    // Two words: the first letter of each.
    expect(initialsOf('Security reviewer', ['Scout'])).toBe('SR')
  })

  test('two names whose first two letters are shared too wear the first letter that differs', () => {
    expect(initialsOf('Reviewer', ['Researcher'])).toBe('RV')
    expect(initialsOf('Researcher', ['Reviewer'])).toBe('RS')
  })

  test('no two names of a set ever wear the same letters', () => {
    const sets = [
      ['Reviewer', 'Researcher', 'Security reviewer', 'Scout', 'Documenter'],
      ['Tester', 'Test writer', 'Tracer'],
      ['Planner', 'Planter', 'Plan checker'],
      ['Ab', 'Ac', 'Ba'],
      ['Explore', 'Explorer'],
    ]
    for (const names of sets) {
      const worn = names.map((name) =>
        initialsOf(
          name,
          names.filter((other) => other !== name),
        ),
      )
      expect(new Set(worn).size, names.join(', ')).toBe(names.length)
    }
  })

  test('the first letter is shared whatever its case', () => {
    expect(initialsOf('scout', ['Security reviewer'])).toBe('SC')
  })
})

describe('The colour of an avatar', () => {
  test('the same name wears the same tone, whoever else is there', () => {
    expect(letterToneOf('Reviewer')).toBe(letterToneOf('Reviewer'))
    expect(LETTER_TONES).toContain(letterToneOf('Reviewer'))
  })

  test('names are spread over the tones rather than piled on one', () => {
    const names = ['Reviewer', 'Security', 'Documenter', 'Planner', 'Explore', 'Scout', 'Tester']
    expect(new Set(names.map(letterToneOf)).size).toBeGreaterThan(2)
  })
})
