#!/usr/bin/env node
/**
 * What a version tag builds: the channel of its packages and the AUR package it updates.
 *
 * semantic-release tags `main` with `vX.Y.Z` and `dev` with `vX.Y.Z-beta.N`, on one version
 * line. The release pipeline builds the packages of a tag, the one it just pushed or one it is
 * asked to build again, and the tag alone says which channel they are.
 *
 *   node tools/release-tag.ts <tag>   print `channel=<prod|beta>` and `aur=<package>`
 */

import type { AurPackage } from './aur-publish.ts'
import type { Channel } from './package-desktop.ts'

export interface Release {
  channel: Extract<Channel, 'prod' | 'beta'>
  aur: AurPackage
}

export function releaseOf(tag: string): Release {
  if (/^v\d+\.\d+\.\d+$/.test(tag)) return { channel: 'prod', aur: 'hemera-bin' }
  if (/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag)) return { channel: 'beta', aur: 'hemera-beta-bin' }
  throw new Error(`${tag} is not a version tag (vX.Y.Z or vX.Y.Z-beta.N)`)
}

if (import.meta.main) {
  try {
    const release = releaseOf(process.argv[2] ?? '')
    console.log(`channel=${release.channel}\naur=${release.aur}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
