import { logForDebugging } from '../../utils/debug.js'
import type { ResolvedCustomModelConfig } from '../../utils/customApiStorage.js'

type AnthropicContentBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  is_error?: boolean
  source?: {
    type?: string
    media_type?: string
    data?: string
  }
  [key: string]: unknown
}

type AnthropicMessage = {
  role: string
  content: string | AnthropicContentBlock[]
}

type AnthropicTool = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

type ToolState = {
  id: string
  name: string
  argumentsText: string
  emittedArgumentLength: number
  started: boolean
  stopped: boolean
  blockIndex: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toPlainText(content: string | AnthropicContentBlock[] | undefined): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(block => {
      if (block.type === 'text') {
        return typeof block.text === 'string' ? block.text : ''
      }
      if (block.type === 'image') {
        return '[image attached]'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractSystemPrompt(system: unknown): string {
  if (typeof system === 'string') {
    return system
  }
  if (!Array.isArray(system)) {
    return ''
  }

  return system
    .map(block => {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function flushUserMessage(
  messages: Array<Record<string, unknown>>,
  pendingParts: Array<Record<string, unknown>>,
): void {
  if (pendingParts.length === 0) {
    return
  }

  messages.push({
    role: 'user',
    content:
      pendingParts.length === 1 && pendingParts[0]?.type === 'text'
        ? pendingParts[0].text
        : [...pendingParts],
  })

  pendingParts.length = 0
}

function normalizeToolResultContent(block: AnthropicContentBlock): string {
  const baseText = toPlainText(block.content)
  return block.is_error ? `[tool error]\n${baseText}` : baseText
}

function hasThinkingBlocksInHistory(messages: AnthropicMessage[]): boolean {
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        return true
      }
    }
  }
  return false
}

function translateMessages(messages: AnthropicMessage[]): Array<Record<string, unknown>> {
  const translated: Array<Record<string, unknown>> = []
  const historyHasThinking = hasThinkingBlocksInHistory(messages)

  for (const message of messages) {
    if (typeof message.content === 'string') {
      translated.push({
        role: message.role,
        content: message.content,
      })
      continue
    }

    if (!Array.isArray(message.content)) {
      continue
    }

    if (message.role === 'user') {
      const pendingParts: Array<Record<string, unknown>> = []

      for (const block of message.content) {
        if (block.type === 'tool_result') {
          flushUserMessage(translated, pendingParts)
          translated.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: normalizeToolResultContent(block),
          })
          continue
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          pendingParts.push({ type: 'text', text: block.text })
          continue
        }

        if (
          block.type === 'image' &&
          isRecord(block.source) &&
          block.source.type === 'base64' &&
          typeof block.source.data === 'string' &&
          typeof block.source.media_type === 'string'
        ) {
          pendingParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })
        }
      }

      flushUserMessage(translated, pendingParts)
      continue
    }

    if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []
      let reasoningContent: string | undefined

      for (const block of message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text)
          continue
        }

        if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string'
        ) {
          reasoningContent = (reasoningContent ?? '') + block.thinking
          continue
        }

        if (
          block.type === 'redacted_thinking' &&
          typeof block.data === 'string'
        ) {
          reasoningContent = (reasoningContent ?? '') + block.data
          continue
        }

        if (
          block.type === 'tool_use' ||
          block.type === 'server_tool_use' ||
          block.type === 'mcp_tool_use'
        ) {
          toolCalls.push({
            id: typeof block.id === 'string' ? block.id : `toolu_${Date.now()}`,
            type: 'function',
            function: {
              name: typeof block.name === 'string' ? block.name : 'tool',
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }

      if (textParts.length > 0 || toolCalls.length > 0 || reasoningContent !== undefined) {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
        }
        if (reasoningContent !== undefined) {
          assistantMsg.reasoning_content = reasoningContent
        } else if (historyHasThinking) {
          assistantMsg.reasoning_content = ''
        }
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls
        }
        translated.push(assistantMsg)
      }
    }
  }

  return translated
}

function translateTools(tools: AnthropicTool[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema ?? {
        type: 'object',
        properties: {},
      },
    },
  }))
}

function translateToolChoice(toolChoice: unknown): unknown {
  if (!isRecord(toolChoice) || typeof toolChoice.type !== 'string') {
    return undefined
  }

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      return typeof toolChoice.name === 'string'
        ? {
            type: 'function',
            function: { name: toolChoice.name },
          }
        : 'auto'
    default:
      return undefined
  }
}

function buildOpenAIChatCompletionsBody(
  anthropicBody: Record<string, unknown>,
  modelConfig: ResolvedCustomModelConfig,
): Record<string, unknown> {
  const messages = translateMessages(
    (anthropicBody.messages ?? []) as AnthropicMessage[],
  )
  const systemPrompt = extractSystemPrompt(anthropicBody.system)
  const tools = Array.isArray(anthropicBody.tools)
    ? translateTools(anthropicBody.tools as AnthropicTool[])
    : undefined
  const toolChoice = translateToolChoice(anthropicBody.tool_choice)
  const stream = anthropicBody.stream !== false

  const requestBody: Record<string, unknown> = {
    model: modelConfig.model,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages,
    stream,
    stream_options: stream ? { include_usage: true } : undefined,
  }

  // OpenAI-compatible APIs typically have lower max_tokens limits than Anthropic
  // DeepSeek max is 8192, OpenAI gpt-4 is 4096-8192 depending on version
  const MAX_OPENAI_COMPATIBLE_TOKENS = 8192

  if (typeof anthropicBody.max_tokens === 'number') {
    requestBody.max_tokens = Math.min(
      anthropicBody.max_tokens,
      MAX_OPENAI_COMPATIBLE_TOKENS,
    )
  }
  if (typeof anthropicBody.temperature === 'number') {
    requestBody.temperature = anthropicBody.temperature
  }
  if (Array.isArray(anthropicBody.stop_sequences) && anthropicBody.stop_sequences.length > 0) {
    requestBody.stop = anthropicBody.stop_sequences
  }
  if (tools && tools.length > 0) {
    requestBody.tools = tools
  }
  if (toolChoice !== undefined) {
    requestBody.tool_choice = toolChoice
  }

  if (modelConfig.apiMode === 'responses') {
    logForDebugging(
      `[API:compatible] responses mode requested for ${modelConfig.name}, falling back to chat_completions`,
      { level: 'warn' },
    )
  }

  return requestBody
}

function buildEndpoint(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) {
    return normalized
  }
  return `${normalized}/chat/completions`
}

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

function emit(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  payload: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(formatSSE(event, JSON.stringify(payload))))
}

function mapFinishReason(
  finishReason: string | null | undefined,
  hadToolUse: boolean,
): string {
  if (finishReason === 'tool_calls') {
    return 'tool_use'
  }
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (finishReason === 'stop') {
    return hadToolUse ? 'tool_use' : 'end_turn'
  }
  return hadToolUse ? 'tool_use' : 'end_turn'
}

function parseToolInput(argumentsText: string): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(argumentsText, {})
  if (isRecord(parsed)) {
    return parsed
  }
  return { value: parsed }
}

async function translateOpenAIResponseToAnthropic(
  response: Response,
  requestedModel: string,
): Promise<Response> {
  const body = (await response.json()) as Record<string, unknown>
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {}
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const contentBlocks: Array<Record<string, unknown>> = []

  // reasoning_content must be preserved for reasoning models (Kimi k1.5, etc.)
  // Always create a thinking block when reasoning_content exists (even empty string)
  // to prevent "reasoning_content is missing" errors on subsequent requests
  if (typeof message.reasoning_content === 'string') {
    contentBlocks.push({
      type: 'thinking',
      thinking: message.reasoning_content,
      signature: '',
    })
  }

  if (typeof message.content === 'string' && message.content.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: message.content,
    })
  }

  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
      continue
    }

    const toolId = typeof toolCall.id === 'string' ? toolCall.id : `toolu_${Date.now()}`
    const toolName =
      typeof toolCall.function.name === 'string' ? toolCall.function.name : 'tool'
    const toolArguments =
      typeof toolCall.function.arguments === 'string'
        ? toolCall.function.arguments
        : '{}'

    contentBlocks.push({
      type: 'tool_use',
      id: toolId,
      name: toolName,
      input: parseToolInput(toolArguments),
    })
  }

  const usage = isRecord(body.usage) ? body.usage : {}
  const finishReason =
    isRecord(choice) && typeof choice.finish_reason === 'string'
      ? choice.finish_reason
      : null
  const requestId = response.headers.get('x-request-id') ?? String(body.id ?? `msg_compatible_${Date.now()}`)

  return new Response(
    JSON.stringify({
      id: String(body.id ?? requestId),
      type: 'message',
      role: 'assistant',
      content: contentBlocks,
      model: String(body.model ?? requestedModel),
      stop_reason: mapFinishReason(finishReason, toolCalls.length > 0),
      stop_sequence: null,
      usage: {
        input_tokens:
          typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
        output_tokens:
          typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
      },
    }),
    {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
      },
    },
  )
}

async function translateOpenAIStreamToAnthropic(
  response: Response,
  requestedModel: string,
): Promise<Response> {
  const requestId = response.headers.get('x-request-id') ?? `msg_compatible_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const reader = response.body?.getReader()
      const toolStates = new Map<number, ToolState>()
      let buffer = ''
      let contentBlockIndex = 0
      let textBlockIndex: number | null = null
      let thinkingBlockIndex: number | null = null
      let inputTokens = 0
      let outputTokens = 0
      let finalStopReason: string | null = null

      emit(controller, encoder, 'message_start', {
        type: 'message_start',
        message: {
          id: requestId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: requestedModel,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })

      const closeTextBlock = () => {
        if (textBlockIndex === null) {
          return
        }
        emit(controller, encoder, 'content_block_stop', {
          type: 'content_block_stop',
          index: textBlockIndex,
        })
        textBlockIndex = null
      }

      const closeThinkingBlock = () => {
        if (thinkingBlockIndex === null) {
          return
        }
        emit(controller, encoder, 'content_block_stop', {
          type: 'content_block_stop',
          index: thinkingBlockIndex,
        })
        thinkingBlockIndex = null
      }

      const startTextBlock = () => {
        if (textBlockIndex !== null) {
          return
        }
        closeThinkingBlock()
        textBlockIndex = contentBlockIndex++
        emit(controller, encoder, 'content_block_start', {
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' },
        })
      }

      const ensureToolState = (index: number): ToolState => {
        const existing = toolStates.get(index)
        if (existing) {
          return existing
        }

        const created: ToolState = {
          id: '',
          name: '',
          argumentsText: '',
          emittedArgumentLength: 0,
          started: false,
          stopped: false,
          blockIndex: null,
        }
        toolStates.set(index, created)
        return created
      }

      const emitPendingToolArguments = (toolState: ToolState) => {
        if (!toolState.started || toolState.blockIndex === null) {
          return
        }

        const nextChunk = toolState.argumentsText.slice(toolState.emittedArgumentLength)
        if (!nextChunk) {
          return
        }

        emit(controller, encoder, 'content_block_delta', {
          type: 'content_block_delta',
          index: toolState.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: nextChunk,
          },
        })
        toolState.emittedArgumentLength = toolState.argumentsText.length
      }

      const ensureToolStarted = (toolState: ToolState) => {
        if (toolState.started || !toolState.name) {
          return
        }

        closeTextBlock()
        closeThinkingBlock()
        toolState.id ||= `toolu_${Date.now()}_${toolStates.size}`
        toolState.blockIndex = contentBlockIndex++
        toolState.started = true

        emit(controller, encoder, 'content_block_start', {
          type: 'content_block_start',
          index: toolState.blockIndex,
          content_block: {
            type: 'tool_use',
            id: toolState.id,
            name: toolState.name,
            input: {},
          },
        })

        emitPendingToolArguments(toolState)
      }

      const closeAllToolBlocks = () => {
        const states = [...toolStates.values()].sort(
          (left, right) => (left.blockIndex ?? 0) - (right.blockIndex ?? 0),
        )

        for (const toolState of states) {
          ensureToolStarted(toolState)
          if (!toolState.started || toolState.stopped || toolState.blockIndex === null) {
            continue
          }

          emitPendingToolArguments(toolState)
          emit(controller, encoder, 'content_block_stop', {
            type: 'content_block_stop',
            index: toolState.blockIndex,
          })
          toolState.stopped = true
        }
      }

      const processEventPayload = (payload: Record<string, unknown>) => {
        if (isRecord(payload.usage)) {
          inputTokens =
            typeof payload.usage.prompt_tokens === 'number'
              ? payload.usage.prompt_tokens
              : inputTokens
          outputTokens =
            typeof payload.usage.completion_tokens === 'number'
              ? payload.usage.completion_tokens
              : outputTokens
        }

        if (!Array.isArray(payload.choices)) {
          return
        }

        for (const rawChoice of payload.choices) {
          if (!isRecord(rawChoice)) {
            continue
          }

          const delta = isRecord(rawChoice.delta) ? rawChoice.delta : {}
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
            if (thinkingBlockIndex === null) {
              closeTextBlock()
              thinkingBlockIndex = contentBlockIndex++
              emit(controller, encoder, 'content_block_start', {
                type: 'content_block_start',
                index: thinkingBlockIndex,
                content_block: { type: 'thinking', thinking: '' },
              })
            }
            emit(controller, encoder, 'content_block_delta', {
              type: 'content_block_delta',
              index: thinkingBlockIndex,
              delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
            })
          }

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            startTextBlock()
            if (textBlockIndex !== null) {
              emit(controller, encoder, 'content_block_delta', {
                type: 'content_block_delta',
                index: textBlockIndex,
                delta: { type: 'text_delta', text: delta.content },
              })
            }
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const rawToolCall of delta.tool_calls) {
              if (!isRecord(rawToolCall)) {
                continue
              }

              const index =
                typeof rawToolCall.index === 'number' ? rawToolCall.index : 0
              const toolState = ensureToolState(index)

              if (typeof rawToolCall.id === 'string') {
                toolState.id = rawToolCall.id
              }

              const fn = isRecord(rawToolCall.function) ? rawToolCall.function : {}
              if (typeof fn.name === 'string' && fn.name.length > 0) {
                toolState.name = fn.name
              }
              if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
                toolState.argumentsText += fn.arguments
              }

              ensureToolStarted(toolState)
              emitPendingToolArguments(toolState)
            }
          }

          if (typeof rawChoice.finish_reason === 'string') {
            finalStopReason = mapFinishReason(
              rawChoice.finish_reason,
              toolStates.size > 0,
            )
          }
        }
      }

      try {
        if (!reader) {
          throw new Error('compatible provider returned an empty response body')
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })

          while (true) {
            const separatorIndex = buffer.indexOf('\n\n')
            if (separatorIndex === -1) {
              break
            }

            const rawEvent = buffer.slice(0, separatorIndex)
            buffer = buffer.slice(separatorIndex + 2)

            const dataLines = rawEvent
              .split(/\r?\n/)
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trim())

            if (dataLines.length === 0) {
              continue
            }

            const payloadText = dataLines.join('\n')
            if (payloadText === '[DONE]') {
              continue
            }

            const payload = safeJsonParse<Record<string, unknown> | null>(
              payloadText,
              null,
            )
            if (!payload) {
              continue
            }

            processEventPayload(payload)
          }
        }
      } catch (error) {
        startTextBlock()
        if (textBlockIndex !== null) {
          emit(controller, encoder, 'content_block_delta', {
            type: 'content_block_delta',
            index: textBlockIndex,
            delta: {
              type: 'text_delta',
              text: `\n\n[Compatible API stream error: ${error instanceof Error ? error.message : String(error)}]`,
            },
          })
        }
      }

      closeTextBlock()
      closeThinkingBlock()
      closeAllToolBlocks()

      emit(controller, encoder, 'message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: finalStopReason ?? mapFinishReason(null, toolStates.size > 0),
          stop_sequence: null,
        },
        usage: { output_tokens: outputTokens },
      })

      emit(controller, encoder, 'message_stop', {
        type: 'message_stop',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      })

      controller.close()
    },
  })

  return new Response(readable, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': requestId,
    },
  })
}

async function readRequestBody(body: RequestInit['body']): Promise<Record<string, unknown>> {
  if (!body) {
    return {}
  }

  try {
    if (typeof body === 'string') {
      return safeJsonParse<Record<string, unknown>>(body, {})
    }
    if (body instanceof ReadableStream) {
      return safeJsonParse<Record<string, unknown>>(await new Response(body).text(), {})
    }
    if (body instanceof URLSearchParams) {
      return safeJsonParse<Record<string, unknown>>(body.toString(), {})
    }
    if (body instanceof ArrayBuffer) {
      return safeJsonParse<Record<string, unknown>>(new TextDecoder().decode(body), {})
    }
    if (ArrayBuffer.isView(body)) {
      return safeJsonParse<Record<string, unknown>>(
        new TextDecoder().decode(body),
        {},
      )
    }
  } catch {
    return {}
  }

  return {}
}

async function buildErrorResponse(response: Response): Promise<Response> {
  const rawText = await response.text()
  const body = safeJsonParse<Record<string, unknown> | null>(rawText, null)
  const nestedError = body && isRecord(body.error) ? body.error : null
  const message =
    typeof nestedError?.message === 'string'
      ? nestedError.message
      : typeof body?.message === 'string'
        ? body.message
        : rawText || `Compatible API error (${response.status})`

  const errorType =
    response.status === 401 || response.status === 403
      ? 'authentication_error'
      : response.status === 404
        ? 'not_found_error'
        : 'api_error'

  return new Response(
    JSON.stringify({
      type: 'error',
      error: {
        type: errorType,
        message,
      },
    }),
    {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...(response.headers.get('x-request-id')
          ? { 'x-request-id': response.headers.get('x-request-id')! }
          : {}),
      },
    },
  )
}

export function createOpenAICompatibleFetch(
  modelConfig: ResolvedCustomModelConfig,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    const anthropicBody = await readRequestBody(init?.body)
    const requestBody = buildOpenAIChatCompletionsBody(anthropicBody, modelConfig)
    const endpoint = buildEndpoint(modelConfig.baseURL)

    logForDebugging(
      `[API:compatible] ${modelConfig.name} -> ${endpoint} model=${modelConfig.model} mode=${modelConfig.apiMode}`,
    )

    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: anthropicBody.stream === false ? 'application/json' : 'text/event-stream',
        ...(modelConfig.apiKey
          ? { Authorization: `Bearer ${modelConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify(requestBody),
      signal: init?.signal,
    })

    if (!response.ok) {
      return buildErrorResponse(response)
    }

    return anthropicBody.stream === false
      ? translateOpenAIResponseToAnthropic(response, modelConfig.model)
      : translateOpenAIStreamToAnthropic(response, modelConfig.model)
  }
}
