/**
 * The words the trigger of the agent menu says for a model (design D17-11), read from the module
 * that decides them.
 *
 * The component around it is a browser story; what is proved without a browser is the part that
 * chooses: a model the agent announced is named with the agent's own word for it, a model the
 * agent reports without offering a row for it is still named, and an agent that has not said what
 * it is on leaves the line to the agent's name alone.
 */

import { describe, expect, test } from 'vite-plus/test'

import { nameOfCurrent } from '../src/composer/current-name.ts'

/** Two models, as an agent announces them: the id is the value, the label is its word for it. */
const MODELS = [
  { id: 'fast', label: 'Fake Fast' },
  { id: 'deep', label: 'Fake Deep' },
]

describe('the model line of the agent trigger', () => {
  test('a model the agent announced is named with the name it announced', () => {
    expect(nameOfCurrent(MODELS, 'deep')).toBe('Fake Deep')
  })

  test('a model the agent reports without offering a row for it is named too', () => {
    // A Session resumed onto a model the picker leaves out: the value is the agent's own word
    // for what it is on, and saying it beats saying nothing about the model.
    expect(nameOfCurrent(MODELS, 'opus-4-6-20260219')).toBe('opus-4-6-20260219')
  })

  test('nothing is named while the agent has not said what it is on', () => {
    expect(nameOfCurrent(MODELS, null)).toBeUndefined()
  })
})
