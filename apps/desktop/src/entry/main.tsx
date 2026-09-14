/**
 * Desktop entry point.
 *
 * It does nothing but load the application, so that the load can fail in the open. Importing
 * it is what loads the renderer addon, and the napi loader reports a missing system library
 * as a missing native binding with advice to reinstall packages: on a machine that is only
 * short of a library, that sends the reader after the wrong thing. The failure is caught here
 * and the library is named.
 */

import { missingLibraryDiagnostic } from '../platform/native-dependencies.ts'

try {
  await import('./app.tsx')
} catch (error) {
  const diagnostic = missingLibraryDiagnostic(error)
  if (diagnostic === null) throw error
  console.error(diagnostic)
  process.exit(1)
}
