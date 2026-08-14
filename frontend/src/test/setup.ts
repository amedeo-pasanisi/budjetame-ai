/** Shared test setup (issue #29): jest-dom matchers for component tests, and
 * an explicit cleanup hook because vitest globals are off (tests import from
 * 'vitest' directly, matching the existing pure-module suite). */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})
