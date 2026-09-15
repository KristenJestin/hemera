/**
 * Whether the renderer installed here carries the GPUI test renderer.
 *
 * The addon comes from the fork checked out beside this repository, and it is compiled with
 * `test-support` or without it: `bun run build` in `packages/native` carries the test
 * renderer, `build:release` is what ships. The capability is read from the addon itself
 * rather than guessed, so nothing here has to know which build is installed.
 *
 * Upstream only reads a rendered image back on macOS and Windows, so a Linux build carries a
 * `TestGpuixRenderer` whose constructor refuses. Suites that paint are skipped where it is
 * absent instead of failing: a run that fails dozens of times for a capability nobody has is
 * a run that gets ignored, and a real regression hides in it.
 */

/** Folders whose suites paint on the GPU test renderer. */
const PAINTING = ['system-tests', 'src']

const needed = Bun.argv.some((argument) => PAINTING.some((folder) => argument.includes(folder)))

function testRendererPaints(): boolean {
  try {
    const native = require('@gpuix/native') as { hasTestGpuixRenderer: () => boolean }
    return native.hasTestGpuixRenderer()
  } catch {
    return false
  }
}

export const TEST_RENDERER_PAINTS = testRendererPaints()

if (!TEST_RENDERER_PAINTS && needed) {
  console.error(
    'the GPU test renderer is not in the installed addon: build the fork with ' +
      '"bun run build" in ../gpuix/packages/native, or run on a target upstream reads a ' +
      'rendered image back on (macOS, Windows). The suites that paint are skipped here',
  )
}
