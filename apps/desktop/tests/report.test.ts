import { describe, expect, test } from 'vite-plus/test'

import { distributionOf } from '../src/main/report.ts'

describe('The environment report', () => {
  test('names the distribution an os-release file names', () => {
    expect(distributionOf('NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\nID=arch\n')).toBe(
      'Arch Linux',
    )
  })

  test('says nothing rather than guess when the file names no distribution', () => {
    expect(distributionOf('ID=unknown\n')).toBeNull()
  })
})
