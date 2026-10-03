/** Where the Profile lives and which build opens it: what every file operation on it starts from. */

import { Context } from 'effect'

export class ProfileHome extends Context.Service<
  ProfileHome,
  {
    readonly dataFolder: string
    /** The version of Hemera running. */
    readonly version: string
    /** The folder of the migrations this build carries. */
    readonly migrations: string
  }
>()('ProfileHome') {}
