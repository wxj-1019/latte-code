import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// vi.mock declarations – vitest hoists these to intercept ALL imports
// (including those inside query.ts), so instanceof checks work correctly.
// ---------------------------------------------------------------------------

vi.mock('../../tools.js', () => ({
  getAllBaseTools: () => [],
  filterToolsByDenyRules: (tools: readonly unknown[]) => tools,
  getTools: () => [],
}))

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
// P0 – Core flow tests (batch 2: Q-004, Q-005)
// ---------------------------------------------------------------------------

describe('query() core flow (batch 2)', () => {
  it('Q-004: handles empty messages without crashing', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      yield simpleAssistantEvent('Empty start')
    })

    const params = createMinimalQueryParams({ deps, messages: [] })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(events.length).toBeGreaterThan(0)
    expect(events.map(e => e.type)).toContain('assistant')
  })

  it('Q-005: abort during streaming terminates gracefully', async () => {
    const abortController = new AbortController()
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      yield simpleAssistantEvent('Partial...')
      abortController.abort()
    })

    const params = createMinimalQueryParams({
      deps,
      toolUseContext: {
        ...createMinimalQueryParams().toolUseContext,
        abortController,
      } as Parameters<typeof createMinimalQueryParams>[0]['toolUseContext'],
    })

    const events: Array<{ type: string }> = []
    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    // Should at least yield stream_request_start before abort
    expect(events.map(e => e.type)).toContain('stream_request_start')
  })
})
