import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// vi.mock declarations – vitest hoists these to intercept ALL imports
// (including those inside query.ts), so instanceof checks work correctly.
// ---------------------------------------------------------------------------

// Prevent getAllBaseTools() from triggering lazy require() chains that vitest
// can't resolve (e.g., SendMessageTool, TeamCreateTool, etc.).
vi.mock('../../tools.js', () => ({
  getAllBaseTools: () => [],
  filterToolsByDenyRules: (tools: readonly unknown[]) => tools,
  getTools: () => [],
}))

// Lightweight mocks for modules imported by query.ts that the core tests
// don't exercise. These prevent vitest from loading their real dependency
// chains, keeping the module graph small enough to avoid OOM.
vi.mock('../../services/api/withRetry.js', () => ({
  FallbackTriggeredError: class FallbackTriggeredError extends Error {
    name = 'FallbackTriggeredError'
  },
}))

vi.mock('../../utils/imageValidation.js', () => ({
  ImageSizeError: class ImageSizeError extends Error {
    name = 'ImageSizeError'
  },
  validateImagesForAPI: () => {},
}))

vi.mock('../../utils/imageResizer.js', () => ({
  ImageResizeError: class ImageResizeError extends Error {
    name = 'ImageResizeError'
  },
}))

import { query } from '../../query.js'
import { createMockDeps } from './helpers/mock-deps.js'
import {
  createMinimalQueryParams,
  simpleAssistantEvent,
} from './helpers/mock-context.js'

// ---------------------------------------------------------------------------
// P0 – Core flow test (Q-001)
// ---------------------------------------------------------------------------

describe('query() core flow', () => {
  it('Q-001: yields stream_request_start and assistant message', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      yield simpleAssistantEvent('Hello, world!')
    })

    const params = createMinimalQueryParams({ deps })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(events.map(e => e.type)).toContain('stream_request_start')
    expect(events.map(e => e.type)).toContain('assistant')
    expect(events.map(e => e.type)).not.toContain('tombstone')
    expect(events.length).toBeGreaterThan(0)
  })
})
