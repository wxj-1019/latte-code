import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { QuerySource } from '../../../constants/querySource.js'
import type {
  ToolPermissionContext,
  ToolUseContext,
  Tools,
} from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'
import type {
  Message,
  StreamEvent,
} from '../../../types/message.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { QueryParams } from '../../../query.js'
import { createMockDeps } from './mock-deps.js'

/**
 * Minimal AbortController factory.
 */
function freshAbortController(): AbortController {
  return new AbortController()
}

/**
 * Bare-minimum AppState stub. Tests that need specific AppState fields
 * should extend this via object spread.
 */
function minimalAppState(): AppState {
  return {
    settings: {},
    verbose: false,
    mainLoopModel: 'claude-sonnet-4-20250514',
    mainLoopModelForSession: 'claude-sonnet-4-20250514',
    statusLineText: undefined,
    expandedView: 'none',
    isBriefOnly: false,
    selectedIPAgentIndex: -1,
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    } as ToolPermissionContext,
    mcp: { clients: [], tools: [], commands: [], resources: {} },
    tasks: {},
    plugins: { enabled: [], disabled: [], errors: {} },
    costTracking: {
      totalCost: 0,
      costsByProvider: {},
    },
    sessionHooks: new Map(),
  } as unknown as AppState
}

/**
 * Minimal ToolUseContext for query loop testing.
 */
export function createMinimalToolUseContext(
  _agentId?: string,
): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-20250514',
      tools: [] as unknown as Tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' } as ThinkingConfig,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: [],
        agents: [],
      },
    },
    abortController: freshAbortController(),
    readFileState: new Map(),
    getAppState: () => minimalAppState(),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

/**
 * Minimal QueryParams for a single-iteration "no tool use" test.
 *
 * @example
 *   const deps = createMockDeps()
 *   deps.callModel.mockImplementation(async function* () {
 *     yield { type: 'assistant', ... }
 *   })
 *   const params = createMinimalQueryParams({ deps })
 */
export function createMinimalQueryParams(
  overrides: Partial<QueryParams> = {},
): QueryParams {
  const deps = overrides.deps ?? createMockDeps()

  return {
    messages: [],
    systemPrompt: asSystemPrompt([]) as SystemPrompt,
    userContext: {},
    systemContext: {},
    canUseTool: (async () => ({ behavior: 'allow' })) as unknown as CanUseToolFn,
    toolUseContext: createMinimalToolUseContext(),
    querySource: 'test' as QuerySource,
    deps,
    ...overrides,
  }
}

/**
 * Create a minimal stream event for a no-tool-use assistant response.
 */
export function simpleAssistantEvent(
  text: string,
): StreamEvent {
  return {
    type: 'assistant',
    uuid: 'msg-test-001',
    message: {
      id: 'msg-test-001',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    },
  } as unknown as StreamEvent
}

/**
 * Create a minimal stream event with a single tool_use block.
 */
export function toolUseAssistantEvent(
  toolId: string,
  toolName: string,
  input: Record<string, unknown>,
): StreamEvent {
  return {
    type: 'assistant',
    uuid: `msg-${toolId}`,
    message: {
      id: `msg-${toolId}`,
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
      usage: { input_tokens: 20, output_tokens: 10 },
      stop_reason: 'tool_use',
    },
  } as unknown as StreamEvent
}
