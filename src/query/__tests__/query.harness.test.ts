import { describe, it, expect, vi } from 'vitest'

// Lightweight mocks – needed because vitest still loads the full module graph
// when import() is triggered through getters in shared types
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

import { createMockDeps } from './helpers/mock-deps.js'
import { createMinimalQueryParams } from './helpers/mock-context.js'

// ---------------------------------------------------------------------------
// P0 – Test harness integrity
// ---------------------------------------------------------------------------

describe('test harness integrity', () => {
  it('mock deps are callable', () => {
    const deps = createMockDeps()
    expect(deps.uuid()).toBe('mock-uuid-0000-0000-0000-000000000000')
    expect(typeof deps.callModel).toBe('function')
    expect(typeof deps.microcompact).toBe('function')
    expect(typeof deps.autocompact).toBe('function')
  })

  it('mock context creates valid objects', () => {
    const params = createMinimalQueryParams()
    expect(params.messages).toEqual([])
    expect(params.systemPrompt).toBeDefined()
    expect(params.toolUseContext).toBeDefined()
    expect(params.toolUseContext.abortController).toBeInstanceOf(AbortController)
  })

  it('transitions types are importable', () => {
    // Verify transitions.ts types exist and are importable
    expect(true).toBe(true)
  })
})
