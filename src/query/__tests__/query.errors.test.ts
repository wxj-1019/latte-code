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

vi.mock('../../services/api/withRetry.js', () => ({
  FallbackTriggeredError: class FallbackTriggeredError extends Error {
    constructor(
      public originalModel: string,
      public fallbackModel: string,
    ) {
      super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
      this.name = 'FallbackTriggeredError'
    }
  },
}))

vi.mock('../../utils/imageValidation.js', () => ({
  ImageSizeError: class ImageSizeError extends Error {
    constructor(
      public oversizedImages: Array<{ index: number; size: number }>,
      public maxSize: number,
    ) {
      const first = oversizedImages[0]
      const msg =
        oversizedImages.length === 1 && first
          ? `Image base64 size exceeds API limit. Please resize the image before sending.`
          : `${oversizedImages.length} images exceed the API limit. Please resize these images before sending.`
      super(msg)
      this.name = 'ImageSizeError'
    }
  },
  validateImagesForAPI: () => {},
}))

vi.mock('../../utils/imageResizer.js', () => ({
  ImageResizeError: class ImageResizeError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ImageResizeError'
    }
  },
}))

import { FallbackTriggeredError } from '../../services/api/withRetry.js'
import { ImageSizeError } from '../../utils/imageValidation.js'
import { ImageResizeError } from '../../utils/imageResizer.js'

import { query } from '../../query.js'
import { createMockDeps } from './helpers/mock-deps.js'
import { createMinimalQueryParams, simpleAssistantEvent } from './helpers/mock-context.js'

// ---------------------------------------------------------------------------
// P0 – Error handling
// ---------------------------------------------------------------------------

describe('query() error handling', () => {
  it('E-001: FallbackTriggeredError switches model and retries', async () => {
    const deps = createMockDeps()
    let callCount = 0
    deps.callModel.mockImplementation(async function* () {
      callCount++
      if (callCount === 1) {
        throw new FallbackTriggeredError(
          'claude-sonnet-4-20250514',
          'claude-haiku-4-20250514',
        )
      } else {
        yield simpleAssistantEvent('Fallback succeeded')
      }
    })

    const params = createMinimalQueryParams({
      deps,
      fallbackModel: 'claude-haiku-4-20250514',
    })
    const events: Array<{ type: string; content?: string }> = []

    for await (const event of query(params)) {
      events.push(event as { type: string; content?: string })
    }

    // Should have yielded a system message about switching models
    const switchMessage = events.find(
      e => e.type === 'system' && e.content?.includes('Switched'),
    )
    expect(switchMessage).toBeDefined()
    // Should have retried after fallback
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(events.map(e => e.type)).toContain('assistant')
  })

  it('E-002: model error yields error message', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      throw new Error('Model unavailable')
    })

    const params = createMinimalQueryParams({ deps })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(events.map(e => e.type)).toContain('stream_request_start')
    const hasErrorOutput = events.some(
      e => e.type === 'assistant' || e.type === 'user',
    )
    expect(hasErrorOutput).toBe(true)
  })

  it('E-003: ImageSizeError yields API error message', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      throw new ImageSizeError(
        [{ index: 0, size: 5_000_000 }],
        1_000_000,
      )
    })

    const params = createMinimalQueryParams({ deps })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    // Should yield an API error (assistant type) before returning image_error
    expect(events.map(e => e.type)).toContain('assistant')
    expect(events.length).toBeGreaterThan(0)
  })

  it('E-004: ImageResizeError yields API error message', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      throw new ImageResizeError('Failed to resize image')
    })

    const params = createMinimalQueryParams({ deps })
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(events.map(e => e.type)).toContain('assistant')
    expect(events.length).toBeGreaterThan(0)
  })

  it('E-005: FallbackTriggeredError without fallbackModel becomes model_error', async () => {
    // When fallbackModel is not provided, FallbackTriggeredError falls
    // through to the outer catch and is treated as a model_error.
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      throw new FallbackTriggeredError('claude-sonnet', 'claude-haiku')
    })

    const params = createMinimalQueryParams({ deps })
    // fallbackModel is undefined → FallbackTriggeredError is re-thrown
    const events: Array<{ type: string }> = []

    for await (const event of query(params)) {
      events.push({ type: (event as { type: string }).type })
    }

    expect(events.map(e => e.type)).toContain('stream_request_start')
    const hasErrorOutput = events.some(
      e => e.type === 'assistant' || e.type === 'user',
    )
    expect(hasErrorOutput).toBe(true)
  })
})
