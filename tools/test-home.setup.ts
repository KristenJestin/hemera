/**
 * Run before every file of the `repository` project: the file runs on a home of its own
 * (`test-home.ts`), removed when the file ends.
 */

import { afterAll } from 'vite-plus/test'

import { installTestHome, removeTestHome } from './test-home.ts'

installTestHome()

afterAll(removeTestHome)
