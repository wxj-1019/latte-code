import { describe, it, expect, vi } from 'vitest'

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
  toolUseAssistantEvent,
} from './helpers/mock-context.js'

// ---------------------------------------------------------------------------
// P0 – Core flow (Q-003: tool_use triggers error + follow-up response)
// ---------------------------------------------------------------------------

describe('query() tool_use handling', () => {
  it('Q-003: tool_use error yields user message and continues', async () => {
    const deps = createMockDeps()
    let callCount = 0
    deps.callModel.mockImplementation(async function* () {
      callCount++
      if (callCount === 1) {
        yield toolUseAssistantEvent('tu-1', 'NonExistentTool', {})
      } else {
        yield simpleAssistantEvent('Fallback text after error')
      }
    })

    const params = createMinimalQueryParams({ deps })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(callCount).toBe(2)
    expect(events.map(e => e.type)).toContain('user')
    expect(events.map(e => e.type)).toContain('assistant')
  })
})
