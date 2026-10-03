import { describe, expect, test } from 'vite-plus/test'

import { channelOf } from '../src/main/identity.ts'

describe('Which channel a run is', () => {
  test('a package says its channel in the manifest it carries', () => {
    expect(channelOf('{"name":"@hemera/desktop","hemera":{"channel":"beta"}}')).toBe('beta')
  })

  test('a development run, whose manifest says nothing, is dev', () => {
    expect(channelOf('{"name":"@hemera/desktop"}')).toBe('dev')
  })

  test('a manifest that names no known channel is dev, never a guess', () => {
    expect(channelOf('{"hemera":{"channel":"nightly"}}')).toBe('dev')
    expect(channelOf('not json')).toBe('dev')
  })
})
