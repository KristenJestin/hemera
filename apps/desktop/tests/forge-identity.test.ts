/**
 * Which forge a repository uses (#253): every remote URL shape parses to its host, owner and slug;
 * `github.com` is GitHub, `bitbucket.org` is Bitbucket Cloud, any other host is unknown until
 * forced, and a forced forge wins over detection.
 */

import { describe, expect, test } from 'vite-plus/test'

import { identify, parseRemote } from '../src/engine/forges/identity.ts'

describe('Every URL shape parses to the right forge, host, owner and slug', () => {
  test.each([
    ['git@github.com:acme/shop.git', 'github.com', 'acme', 'shop'],
    ['git@github.com:acme/shop', 'github.com', 'acme', 'shop'],
    ['https://github.com/acme/shop.git', 'github.com', 'acme', 'shop'],
    ['https://github.com/acme/shop', 'github.com', 'acme', 'shop'],
    ['ssh://git@github.com/acme/shop.git', 'github.com', 'acme', 'shop'],
    ['git@bitbucket.org:acme-team/shop.git', 'bitbucket.org', 'acme-team', 'shop'],
    ['https://someone@bitbucket.org/acme-team/shop.git', 'bitbucket.org', 'acme-team', 'shop'],
    ['ssh://git@git.acme.test:7999/proj/shop.git', 'git.acme.test', 'proj', 'shop'],
    ['https://git.acme.test/scm/proj/shop.git', 'git.acme.test', 'proj', 'shop'],
    ['https://git.acme.test/bitbucket/scm/proj/shop.git', 'git.acme.test', 'proj', 'shop'],
    ['https://GitHub.com/acme/shop.git', 'github.com', 'acme', 'shop'],
  ])('%s', (url, host, owner, slug) => {
    expect(parseRemote(url)).toEqual({ host, owner, slug })
  })

  test('what is not a remote URL parses to nothing', () => {
    expect(parseRemote('/srv/git/shop.git')).toBeNull()
    expect(parseRemote('../shop')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})

describe('An unknown host is unknown until forced; forced wins', () => {
  test('github.com is GitHub and bitbucket.org is Bitbucket Cloud', () => {
    expect(identify('git@github.com:acme/shop.git', null)).toEqual({
      forge: 'github',
      host: 'github.com',
      owner: 'acme',
      slug: 'shop',
      forced: false,
    })
    expect(identify('https://bitbucket.org/acme-team/shop.git', null).forge).toBe('bitbucket-cloud')
  })

  test('any other host is unknown', () => {
    expect(identify('https://git.acme.test/scm/proj/shop.git', null)).toEqual({
      forge: 'unknown',
      host: 'git.acme.test',
      owner: 'proj',
      slug: 'shop',
      forced: false,
    })
  })

  test('a repository without a remote is unknown, with no host', () => {
    expect(identify(null, null)).toEqual({
      forge: 'unknown',
      host: null,
      owner: null,
      slug: null,
      forced: false,
    })
  })

  test('Bitbucket Data Center forced on its host makes the unknown host known', () => {
    expect(
      identify('ssh://git@git.acme.test:7999/proj/shop.git', {
        forge: 'bitbucket-datacenter',
        host: 'git.acme.test',
      }),
    ).toEqual({
      forge: 'bitbucket-datacenter',
      host: 'git.acme.test',
      owner: 'proj',
      slug: 'shop',
      forced: true,
    })
  })

  test('forced wins over detection: none on a GitHub remote', () => {
    expect(identify('git@github.com:acme/shop.git', { forge: 'none', host: null })).toEqual({
      forge: 'none',
      host: null,
      owner: 'acme',
      slug: 'shop',
      forced: true,
    })
  })

  test('GitHub forced with no host is github.com; with one, an Enterprise Server', () => {
    expect(identify(null, { forge: 'github', host: null }).host).toBe('github.com')
    expect(
      identify('https://git.acme.test/acme/shop.git', { forge: 'github', host: 'git.acme.test' }),
    ).toEqual({ forge: 'github', host: 'git.acme.test', owner: 'acme', slug: 'shop', forced: true })
  })

  test('Bitbucket Cloud forced is bitbucket.org', () => {
    expect(identify(null, { forge: 'bitbucket-cloud', host: null }).host).toBe('bitbucket.org')
  })
})
