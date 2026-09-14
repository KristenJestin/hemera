import { describe, expect, test } from 'bun:test'

import { missingLibraryDiagnostic } from '../src/platform/native-dependencies.ts'

/** The sentence the napi loader answers with, whatever the reason the addon did not load. */
const NAPI_MESSAGE =
  'Cannot find native binding. npm has a bug related to optional dependencies ' +
  '(https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both ' +
  'package-lock.json and node_modules directory.'

function napiFailure(cause: string): Error {
  return new Error(NAPI_MESSAGE, {
    cause: new Error(cause, { cause: new Error("Cannot find module './gpuix-native.node'") }),
  })
}

describe('Dépendance système manquante', () => {
  test('a library the loader could not open is named, not the packaging', () => {
    const diagnostic = missingLibraryDiagnostic(
      napiFailure('libxcb.so.1: cannot open shared object file: No such file or directory'),
    )
    expect(diagnostic).toContain('libxcb.so.1')
    // The loader blames npm and asks for a reinstall; the reader is short of a library.
    expect(diagnostic).not.toContain('npm')
    expect(diagnostic).toContain('SYSTEM-REQUIREMENTS.md')
  })

  test('a library present but unusable is named by the same path', () => {
    const diagnostic = missingLibraryDiagnostic(
      napiFailure('/opt/x/libxkbcommon-x11.so.0: file too short'),
    )
    expect(diagnostic).toContain('libxkbcommon-x11.so.0')
  })

  test('a failure that names no library is left to the caller', () => {
    expect(missingLibraryDiagnostic(new Error('the profile is locked'))).toBeNull()
    expect(missingLibraryDiagnostic(napiFailure('no binding for this platform'))).toBeNull()
  })

  test('a chain that loops is read once instead of forever', () => {
    const looping = new Error('outer') as Error & { cause?: unknown }
    looping.cause = looping
    expect(missingLibraryDiagnostic(looping)).toBeNull()
  })

  test('several failures reported together are all read', () => {
    const grouped = new Error(NAPI_MESSAGE, {
      cause: [new Error('no binding for this platform'), new Error('libvulkan.so.1: not found')],
    })
    expect(missingLibraryDiagnostic(grouped)).toContain('libvulkan.so.1')
  })
})
