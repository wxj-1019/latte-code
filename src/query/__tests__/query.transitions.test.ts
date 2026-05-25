import { describe, it, expect, vi } from 'vitest'
import type { Terminal } from '../transitions.js'

// ---------------------------------------------------------------------------
// vi.mock declarations
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
  toolUseAssistantEvent,
} from './helpers/mock-context.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain an AsyncGenerator and return both the yielded events and the terminal. */
async function drainQuery(
  params: Parameters<typeof query>[0],
): Promise<{ events: Array<{ type: string }>; terminal: Terminal }> {
  const gen = query(params)
  const events: Array<{ type: string }> = []
  let result = await gen.next()
  while (!result.done) {
    events.push({ type: (result.value as { type: string }).type })
    result = await gen.next()
  }
  return { events, terminal: result.value as Terminal }
}

// ---------------------------------------------------------------------------
// P0 – State transition tests
// ---------------------------------------------------------------------------

describe('query() terminal states', () => {
  it('T-001: simple text response completes with reason=completed', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function* () {
      yield simpleAssistantEvent('Hello')
    })

    const params = createMinimalQueryParams({ deps })
    const { events, terminal } = await drainQuery(params)

    expect(events.map(e => e.type)).toContain('assistant')
    expect(terminal.reason).toBe('completed')
  })

  it('T-002: tool_use error then text completes with reason=completed', async () => {
    const deps = createMockDeps()
    let callCount = 0
    deps.callModel.mockImplementation(async function* () {
      callCount++
      if (callCount === 1) {
        yield toolUseAssistantEvent('tu-1', 'NonExistentTool', {})
      } else {
        yield simpleAssistantEvent('All done')
      }
    })

    const params = createMinimalQueryParams({ deps })
    const { events, terminal } = await drainQuery(params)

    expect(callCount).toBe(2)
    expect(events.map(e => e.type)).toContain('user')
    expect(events.map(e => e.type)).toContain('assistant')
    expect(terminal.reason).toBe('completed')
  })

  it('T-003: abort during streaming terminates with aborted_streaming', async () => {
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

    const { terminal } = await drainQuery(params)

    expect(terminal.reason).toBe('aborted_streaming')
  })

  it('T-004: maxTurns reached terminates with reason=max_turns', async () => {
    const deps = createMockDeps()
    let callCount = 0
    deps.callModel.mockImplementation(async function* () {
      callCount++
      // Each call triggers a tool_use → query keeps looping
      // With maxTurns=1, it should stop after hitting the limit
      yield toolUseAssistantEvent(`tu-${callCount}`, 'NonExistentTool', {})
    })

    const params = createMinimalQueryParams({ deps, maxTurns: 1 })
    const { terminal } = await drainQuery(params)

    // First turn completes (counts as 1), then hits maxTurns limit
    expect(terminal.reason).toBe('max_turns')
    if (terminal.reason === 'max_turns') {
      expect(typeof terminal.turnCount).toBe('number')
    }
  })
})
