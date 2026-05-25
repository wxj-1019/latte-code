import { vi } from 'vitest'
import type { QueryDeps } from '../../../query/deps.js'

/**
 * Mock implementations of all 4 QueryDeps for testing query() / queryLoop().
 *
 * Each dep returns a sensible no-op default. Individual tests override
 * specific deps via `mockImplementation` or `mockResolvedValue`.
 *
 * Usage:
 *   const deps = createMockDeps()
 *   deps.callModel.mockImplementation(async function*() { ... })
 *   const params = createMinimalParams({ deps })
 */
export function createMockDeps(
  overrides: Partial<QueryDeps> = {},
): QueryDeps {
  return {
    callModel: vi.fn().mockImplementation(async function* () {
      // Default: yield nothing (empty stream)
    }),
    microcompact: vi.fn().mockResolvedValue({
      messages: [] as never[],
      compactionInfo: undefined,
    }),
    autocompact: vi.fn().mockResolvedValue({ wasCompacted: false }),
    uuid: vi.fn().mockReturnValue('mock-uuid-0000-0000-0000-000000000000'),
    ...overrides,
  } as QueryDeps
}
