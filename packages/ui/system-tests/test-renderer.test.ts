import { describe, expect, test } from 'bun:test'

import { hasTestGpuixRenderer } from '@gpuix/native'

describe('Test renderer disponible', () => {
  test('the vendored test-support addon exposes the GPUI test renderer', () => {
    expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toContain('test-support')
    expect(hasTestGpuixRenderer()).toBe(true)
  })
})
