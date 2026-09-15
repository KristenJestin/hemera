/**
 * Desktop entry point.
 *
 * It does nothing but load the application, so that the load can fail in the open. Importing
 * it is what loads the renderer addon, and the napi loader reports a missing system library
 * as a missing native binding with advice to reinstall packages: on a machine that is only
 * short of a library, that sends the reader after the wrong thing. The failure is caught here
 * and the library is named.
 *
 * It is also the one failure nobody can read: the application never reaches its own logging,
 * and a package started from a desktop icon has no console. The diagnostic is written to the
 * profile of this channel, which is a path, not something that has to open.
 */

import { openDiagnosticLog } from '@hemera/runtime'

import { missingLibraryDiagnostic } from '../platform/native-dependencies.ts'
import { packagingOf } from '../platform/packaging.ts'
import { profileDirectoryOf } from '../platform/workspace.ts'

try {
  await import('./app.tsx')
} catch (error) {
  const diagnostic = missingLibraryDiagnostic(error)
  if (diagnostic === null) throw error
  try {
    openDiagnosticLog(profileDirectoryOf(packagingOf())).error(diagnostic)
  } catch {
    // Writing the diagnostic must never replace the diagnostic itself.
    console.error(diagnostic)
  }
  process.exit(1)
}
