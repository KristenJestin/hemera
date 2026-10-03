import { describe, expect, test } from 'vite-plus/test'

import { releaseOf } from './release-tag.ts'

describe('A tag chooses the channel its packages are built as', () => {
  test('a release tag from main builds prod and publishes hemera-bin', () => {
    expect(releaseOf('v0.4.0')).toEqual({ channel: 'prod', aur: 'hemera-bin' })
  })

  test('a beta tag from dev builds beta and publishes hemera-beta-bin', () => {
    expect(releaseOf('v0.5.0-beta.1')).toEqual({ channel: 'beta', aur: 'hemera-beta-bin' })
    expect(releaseOf('v0.5.0-beta.12')).toEqual({ channel: 'beta', aur: 'hemera-beta-bin' })
  })

  test.each(['beta-0.1.1-26-g8394bab', '0.4.0', 'v0.4', 'v0.5.0-rc.1', 'v0.5.0-beta', ''])(
    '%j is not a version tag and builds nothing',
    (tag) => {
      expect(() => releaseOf(tag)).toThrow()
    },
  )
})
