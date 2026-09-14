/**
 * Points the napi loader at the vendored addon that carries the GPUI test renderer, before
 * any test imports the renderer.
 *
 * The shipped build deliberately leaves `gpui/test-support` out (fork patch 0007), so the
 * component tests cannot use the installed addon. Nothing here changes what is installed:
 * the loader honours `NAPI_RS_NATIVE_LIBRARY_PATH` and the test addon is only read.
 *
 * The addon is a build artefact, absent from a fresh checkout. Only the suites that paint
 * need it, so a run that names none of their folders goes on without it rather than stopping
 * the business suite on a machine that has never compiled the renderer.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..', '..')
const version = '0.7.0-hemera.1'
const vendor = join(repository, 'vendor', 'gpuix', version)

interface Manifest {
  testSupport: { file: string; target: string }[]
}

function targetOfThisHost(): string {
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu'
  throw new Error(`no test renderer is vendored for ${process.platform}/${process.arch}`)
}

const manifest = JSON.parse(readFileSync(join(vendor, 'manifest.json'), 'utf8')) as Manifest
const target = targetOfThisHost()

/** Folders whose suites paint on the GPU test renderer. */
const PAINTING = ['system-tests', 'src']

const needed = Bun.argv.some((argument) => PAINTING.some((folder) => argument.includes(folder)))

const addon = manifest.testSupport.find((entry) => entry.target === target)
if (addon === undefined) {
  if (needed) {
    throw new Error(
      `no test-support addon vendored for ${target}; ` +
        'run "bun tools/gpuix/build-native.ts --test-support" then "bun tools/gpuix/pack-vendor.ts"',
    )
  }
} else {
  const path = join(vendor, 'test-support', addon.file)
  if (existsSync(path)) {
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path
  } else if (needed) {
    throw new Error(
      `the vendored test-support addon is missing at ${path}; ` +
        'run "bun tools/gpuix/build-native.ts --test-support" then "bun tools/gpuix/pack-vendor.ts"',
    )
  }
}

/**
 * Whether the vendored test renderer of this host actually paints.
 *
 * The addon compiles for every target, but upstream only reads a rendered image back on macOS
 * and Windows: a Linux build carries a `TestGpuixRenderer` whose constructor refuses. The
 * capability is read from the addon itself rather than guessed from the platform, so a target
 * that gains it upstream needs no change here.
 *
 * Suites that paint are skipped where it is absent instead of failing. A run that fails the
 * same way dozens of times for a capability nobody has is a run that gets ignored, and a real
 * regression hides in it.
 */
function testRendererPaints(): boolean {
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH === undefined) return false
  try {
    const native = require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH) as {
      hasTestGpuixRenderer: () => boolean
    }
    return native.hasTestGpuixRenderer()
  } catch {
    return false
  }
}

export const TEST_RENDERER_PAINTS = testRendererPaints()

if (!TEST_RENDERER_PAINTS && needed) {
  console.error(
    'the GPU test renderer does not exist on this target: upstream does not read the rendered ' +
      'image back outside macOS and Windows, so the suites that paint are skipped here',
  )
}
