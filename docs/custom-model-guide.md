# 自定义模型接入改造指南

> 本文档基于对项目源码的深度分析和 Doge Code 适配器模式的最佳实践，提供将本项目（Claude Code）接入第三方 AI 模型的完整改造方案。

***

## 目录

- [一、现状分析](#一现状分析)
- [二、改造策略](#二改造策略)
- [三、架构设计](#三架构设计)
- [四、改造实施（分阶段）](#四改造实施分阶段)
  - [阶段 1：配置与存储层](#阶段-1配置与存储层)
  - [阶段 2：Provider 抽象与分发](#阶段-2provider-抽象与分发)
  - [阶段 3：OpenAI 兼容适配器](#阶段-3openai-兼容适配器)
  - [阶段 4：Gemini 兼容适配器](#阶段-4gemini-兼容适配器)
  - [阶段 5：认证流程与交互式配置](#阶段-5认证流程与交互式配置)
  - [阶段 6：命令与管理](#阶段-6命令与管理)
- [五、格式映射参考](#五格式映射参考)
- [六、关键风险与注意事项](#六关键风险与注意事项)
- [七、测试验证方案](#七测试验证方案)

***

## 一、现状分析

### 1.1 与 Anthropic API 的耦合层次

当前项目与 Anthropic API 的耦合分布在 5 个关键层面：

| 耦合层         | 核心文件                                  | 耦合程度                                      |
| ----------- | ------------------------------------- | ----------------------------------------- |
| SDK 类型贯穿    | `claude.ts`, `Tool.ts`, `messages.ts` | 极高 — 19+ 个 `Beta*` 类型直接使用                 |
| 流式协议        | `claude.ts` L1979-2304                | 极高 — Anthropic 专有 SSE 事件类型                |
| 消息格式        | `query.ts`, `messages.ts`             | 高 — `tool_use`/`tool_result`/`thinking` 块 |
| Tool Schema | `api.ts` L119-266                     | 高 — `input_schema` 字段名                    |
| 专有功能        | `claude.ts` 多处                        | 中 — cache\_control, thinking, fast mode   |

### 1.2 关键入口点

改造的切入点集中在以下函数：

```
src/services/api/claude.ts
├── queryModel()              L1017   ← 主查询循环（async generator）
│   ├── paramsFromContext()   L1538   ← 构建 Anthropic SDK 请求参数
│   ├── getAnthropicClient()  via client.ts ← 创建 API Client
│   └── stream processing     L1979   ← SSE 事件解析
│
├── queryModelWithoutStreaming()  L709    ← 非流式入口
└── queryModelWithStreaming()     L752    ← 流式入口

src/services/api/client.ts
└── getAnthropicClient()      L96     ← Client 工厂函数
    ├── new AnthropicBedrock()   L161
    ├── new AnthropicFoundry()   L199
    ├── new AnthropicVertex()    L229
    └── new Anthropic()          L324  ← 默认第一方 Client

src/utils/model/providers.ts
└── getAPIProvider()           L6      ← Provider 判定逻辑

src/utils/auth.ts
└── getAnthropicApiKeyWithSource()  L227  ← API Key 获取优先级链
```

### 1.3 现有的多 Provider 支持

项目已有 Bedrock/Vertex/Foundry 的支持，但它们都走 **Anthropic 协议**（只是认证和端点不同）。接入第三方 AI 需要**协议级转换**，这是本质区别。

***

## 二、改造策略

### 2.1 策略选择：边界适配器模式（参考 Doge Code）

```
                        Doge Code 的做法 ✅（推荐）
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   内部代码全部保持 Anthropic Messages API 格式不变            │
│                                                           │
│   只在 API 调用边界做双向格式转换：                            │
│     请求：Anthropic 格式 → 目标格式                          │
│     响应：目标格式 → Anthropic 格式                           │
│                                                           │
│   优点：改动最小，内部逻辑零修改，query.ts / QueryEngine.ts   │
│         / Tool.ts / REPL.tsx 等完全不变                     │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 2.2 核心原则

1. **内部格式不变** — 所有内部代码继续使用 Anthropic 的消息格式（`tool_use`/`tool_result`/`thinking`）
2. **边界转换** — 只在 `queryModel()` 函数的 API 调用点插入适配器
3. **配置驱动** — 通过环境变量和配置文件控制 Provider 类型
4. **渐进式** — 分 6 个阶段实施，每个阶段独立可验证

***

## 三、架构设计

### 3.1 请求转换流程

```
┌────────────────────────────────────────────────────────────────┐
│                    queryModel() 函数内部                        │
│                                                                │
│  1. paramsFromContext() 构建 Anthropic 格式参数                 │
│     ↓                                                          │
│  2. 判定 compatProvider                                        │
│     ↓                                                          │
│  ┌─────────────┬──────────────────┬──────────────────────┐     │
│  │ 'anthropic' │ 'openai'         │ 'gemini'             │     │
│  │ (原生路径)   │                  │                      │     │
│  │             ↓                  ↓                      │     │
│  │  直接调用    │ convertAnthro-   │ convertAnthro-       │     │
│  │  SDK        │ picToOpenAI()    │ picToGemini()        │     │
│  │             ↓                  ↓                      │     │
│  │  Anthropic  │ POST             │ POST                 │     │
│  │  SDK Stream │ /chat/           │ /models/{m}:         │     │
│  │             │ completions      │ streamGenerateContent│     │
│  │             ↓                  ↓                      │     │
│  │  直接消费   │ convertOpenAI-   │ convertGemini-       │     │
│  │  Anthropic  │ ToAnthropic()   │ ToAnthropic()        │     │
│  │  Stream     │ 转回 Anthropic   │ 转回 Anthropic        │     │
│  │             ↓                  ↓                      │     │
│  └─────────────┴──────────────────┴──────────────────────┘     │
│                     ↓                                          │
│              统一的 Anthropic 格式流                             │
│              后续 queryModel 逻辑完全不变                        │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 新增文件清单

```
src/
├── services/api/
│   ├── openaiCompat.ts        ← 【新增】OpenAI 兼容适配器
│   └── geminiCompat.ts        ← 【新增】Gemini 兼容适配器
├── utils/
│   ├── customApiStorage.ts    ← 【新增】自定义 API 配置的安全存储
│   └── model/
│       └── providers.ts       ← 【修改】新增 provider 判定逻辑
├── utils/config.ts            ← 【修改】新增 customApiEndpoint 类型
├── services/api/
│   ├── claude.ts              ← 【修改】queryModel 中插入 provider 分发
│   └── client.ts              ← 【修改】支持自定义 API client
├── components/
│   └── ConsoleOAuthFlow.tsx   ← 【修改】新增交互式配置选项
└── commands/
    └── addModel.ts            ← 【新增】/add-model 命令
```

***

## 四、改造实施（分阶段）

### 阶段 1：配置与存储层

#### 1.1 扩展全局配置类型

**文件**: `src/utils/config.ts`

在 `GlobalConfig` 类型中新增 `customApiEndpoint` 字段：

```typescript
// 在 GlobalConfig 类型中新增
export type CustomApiEndpoint = {
  provider?: 'anthropic' | 'openai' | 'gemini'
  openaiCompatMode?: 'chat_completions' | 'responses'
  baseURL?: string
  model?: string
  savedModels?: string[]
}

export type GlobalConfig = {
  // ... 现有字段 ...

  customApiEndpoint?: CustomApiEndpoint
}
```

#### 1.2 新建安全存储工具

**新建文件**: `src/utils/customApiStorage.ts`

```typescript
import { readSecureStorage, writeSecureStorage } from './secureStorage'
import type { CustomApiEndpoint } from './config'

const STORAGE_KEY = 'customApiEndpoint'

export function readCustomApiStorage(): CustomApiEndpoint | null {
  const storage = readSecureStorage()
  return storage?.[STORAGE_KEY] ?? null
}

export function writeCustomApiStorage(config: CustomApiEndpoint): void {
  const storage = readSecureStorage() ?? {}
  storage[STORAGE_KEY] = config
  writeSecureStorage(storage)
}

export function clearCustomApiStorage(): void {
  const storage = readSecureStorage() ?? {}
  delete storage[STORAGE_KEY]
  writeSecureStorage(storage)
}

export function getMergedCustomApiConfig(): CustomApiEndpoint {
  const { getGlobalConfig } = require('./config')
  return {
    ...(getGlobalConfig().customApiEndpoint ?? {}),
    ...(readCustomApiStorage() ?? {}),
  }
}

export function getCompatProvider(): 'anthropic' | 'openai' | 'gemini' {
  const envProvider = process.env.CLAUDE_CODE_COMPATIBLE_API_PROVIDER
  if (envProvider === 'openai' || envProvider === 'gemini') {
    return envProvider
  }
  return getMergedCustomApiConfig().provider ?? 'anthropic'
}
```

#### 1.3 新增环境变量

| 环境变量                                  | 用途                        | 示例                         |
| ------------------------------------- | ------------------------- | -------------------------- |
| `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` | 协议类型                      | `openai` / `gemini`        |
| `ANTHROPIC_BASE_URL`                  | API Base URL（已有，SDK 自动读取） | `https://api.deepseek.com` |
| `DOGE_API_KEY`                        | 第三方 API Key               | `sk-xxx`                   |
| `ANTHROPIC_MODEL`                     | 模型名称（已有）                  | `deepseek-chat`            |

***

### 阶段 2：Provider 抽象与分发

#### 2.1 修改 Provider 判定逻辑

**文件**: `src/utils/model/providers.ts`

```typescript
// 新增 compatProvider 判定
export function getAPIProvider(): APIProvider {
  const compatProvider = getCompatProvider()
  if (compatProvider === 'openai') return 'openai-compat'
  if (compatProvider === 'gemini') return 'gemini-compat'

  // 原有逻辑
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}
```

#### 2.2 修改 queryModel 的分发逻辑

**文件**: `src/services/api/claude.ts`

在 `queryModel()` 函数中，**在调用** **`anthropic.beta.messages.create()`** **之前**插入 Provider 分发：

```typescript
// 在 queryModel 函数内，约 L1780 处（getAnthropicClient 调用附近）
// 原代码：
//   const anthropic = await getAnthropicClient(...)
//   const result = await anthropic.beta.messages.create({ ...params, stream: true })

// 改为：
const compatProvider = getCompatProvider()

if (compatProvider === 'openai') {
  // 走 OpenAI 兼容路径
  const customConfig = getMergedCustomApiConfig()
  const apiKey = process.env.DOGE_API_KEY ?? customConfig.apiKey ?? ''
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? customConfig.baseURL ?? ''

  yield* createOpenAICompatStream({
    params,          // Anthropic 格式的请求参数
    apiKey,
    baseURL,
    model: options.model,
    signal,
  })
} else if (compatProvider === 'gemini') {
  // 走 Gemini 兼容路径
  const customConfig = getMergedCustomApiConfig()
  const apiKey = process.env.DOGE_API_KEY ?? customConfig.apiKey ?? ''
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? customConfig.baseURL ?? ''

  yield* createGeminiCompatStream({
    params,
    apiKey,
    baseURL,
    model: options.model,
    signal,
  })
} else {
  // 原有 Anthropic 路径（完全不变）
  const anthropic = await getAnthropicClient(...)
  const result = await anthropic.beta.messages.create({ ...params, stream: true })
  // ... 后续流式处理逻辑完全不变
}
```

**关键设计**：后续的流式事件消费循环（`message_start` / `content_block_start` / `content_block_delta` 等）**完全不需要修改**，因为 OpenAI/Gemini 适配器会将响应**转换回 Anthropic 格式**后 yield 出来。

***

### 阶段 3：OpenAI 兼容适配器

**新建文件**: `src/services/api/openaiCompat.ts`

这是整个改造的核心。需要实现两个函数：

#### 3.1 请求转换：Anthropic → OpenAI

```typescript
export function convertAnthropicRequestToOpenAI(params: {
  system: SystemPromptBlock[]
  messages: BetaMessageParam[]
  tools: BetaToolUnion[]
  max_tokens: number
  thinking?: ThinkingConfig
  model: string
}): {
  url: string
  body: object
} {
  const { system, messages, tools, max_tokens, thinking, model } = params

  // 1. System prompt 转换
  const systemText = Array.isArray(system)
    ? system
        .filter((s): s is { type: 'text'; text: string } => s.type === 'text')
        .map(s => s.text)
        .join('\n\n')
    : typeof system === 'string'
      ? system
      : ''

  // 2. Messages 转换
  const openaiMessages: OpenAIChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const converted = convertUserMessage(msg)
      openaiMessages.push(...converted)
    } else if (msg.role === 'assistant') {
      const converted = convertAssistantMessage(msg)
      openaiMessages.push(...converted)
    }
  }

  // 3. Tools 转换：input_schema → parameters
  const openaiTools = tools
    .filter(t => t.type === 'custom' || !t.type)
    .map(t => ({
      type: 'function' as const,
      function: {
        name: (t as any).name,
        description: (t as any).description,
        parameters: (t as any).input_schema,
      },
    }))

  return {
    url: '', // baseURL 由调用方拼接
    body: {
      model,
      messages: [
        { role: 'system', content: systemText },
        ...openaiMessages,
      ],
      ...(openaiTools.length > 0 && {
        tools: openaiTools,
        tool_choice: 'auto',
      }),
      max_tokens,
      stream: true,
      ...(thinking?.type === 'enabled' && {
        temperature: 0.6,
      }),
    },
  }
}
```

**消息转换细节**（最关键的部分）：

```typescript
// Assistant 消息中的 tool_use → OpenAI tool_calls
function convertAssistantMessage(msg: BetaAssistantMessageParam): OpenAIChatMessage[] {
  const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content as string }]

  const textParts: string[] = []
  const toolCalls: OpenAIToolCall[] = []
  const thinkingParts: string[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input),
        },
      })
    } else if (block.type === 'thinking') {
      thinkingParts.push(block.thinking)
    }
    // redacted_thinking, server_tool_use 等类型直接忽略
  }

  const result: OpenAIChatMessage = {
    role: 'assistant',
    ...(textParts.length > 0 && { content: textParts.join('\n') }),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  }

  const messages: OpenAIChatMessage[] = []
  // 如果有 thinking 内容，作为前置 assistant 消息（部分模型支持 reasoning_content）
  if (thinkingParts.length > 0) {
    // DeepSeek-R1 使用 reasoning_content 字段，这里可以忽略
    // 因为 thinking 块只存在于历史消息中，不影响新请求
  }
  messages.push(result)
  return messages
}

// User 消息中的 tool_result → OpenAI tool role
function convertUserMessage(msg: BetaUserMessageParam): OpenAIChatMessage[] {
  const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content as string }]
  const messages: OpenAIChatMessage[] = []

  const textParts: string[] = []
  const toolResults: OpenAIToolResult[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_result') {
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content),
      })
    }
    // image 块需要特殊处理
  }

  if (textParts.length > 0) {
    messages.push({ role: 'user', content: textParts.join('\n') })
  }
  messages.push(...toolResults)

  return messages
}
```

#### 3.2 响应转换：OpenAI SSE → Anthropic 格式流

```typescript
export async function* createOpenAICompatStream(params: {
  params: AnthropicRequestParams
  apiKey: string
  baseURL: string
  model: string
  signal: AbortSignal
}): AsyncGenerator<AnthropicStreamEvent | AssistantMessage> {

  const { params: anthropicParams, apiKey, baseURL, model, signal } = params

  // 1. 转换请求格式
  const openaiRequest = convertAnthropicRequestToOpenAI({
    system: anthropicParams.system,
    messages: anthropicParams.messages,
    tools: anthropicParams.tools,
    max_tokens: anthropicParams.max_tokens,
    thinking: anthropicParams.thinking,
    model,
  })

  // 2. 发送请求
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openaiRequest.body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `OpenAI compatible request failed with status ${response.status}: ${errorText}`
    )
  }

  // 3. 解析 SSE 流并转换为 Anthropic 格式
  yield* createAnthropicStreamFromOpenAI(response)
}

async function* createAnthropicStreamFromOpenAI(
  response: Response
): AsyncGenerator<AnthropicStreamEvent | AssistantMessage> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Anthropic 格式状态
  let contentBlocks: any[] = []
  let currentToolUseIndex = -1
  let toolUseIdCounter = 0
  let messageStarted = false
  let usage = { input_tokens: 0, output_tokens: 0 }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const chunk = JSON.parse(data)
          const choice = chunk.choices?.[0]
          if (!choice) continue

          // message_start（首次收到数据时）
          if (!messageStarted) {
            messageStarted = true
            usage.input_tokens = chunk.usage?.prompt_tokens ?? 0
            yield {
              type: 'message_start',
              message: {
                type: 'message',
                role: 'assistant',
                content: [],
                model: chunk.model ?? '',
                usage: { input_tokens: usage.input_tokens, output_tokens: 0 },
              },
            }
          }

          const delta = choice.delta

          // 文本内容 → text content_block
          if (delta?.content) {
            const textIndex = contentBlocks.findIndex(b => b.type === 'text' && b._isCurrent)
            if (textIndex === -1) {
              // content_block_start: text
              const block = { type: 'text', text: '', _isCurrent: true }
              contentBlocks.push(block)
              yield {
                type: 'content_block_start',
                index: contentBlocks.length - 1,
                content_block: { type: 'text', text: '' },
              }
              yield {
                type: 'content_block_delta',
                index: contentBlocks.length - 1,
                delta: { type: 'text_delta', text: delta.content },
              }
            } else {
              yield {
                type: 'content_block_delta',
                index: textIndex,
                delta: { type: 'text_delta', text: delta.content },
              }
            }
          }

          // 推理内容 → thinking content_block（DeepSeek-R1 的 reasoning_content）
          if (delta?.reasoning_content) {
            const thinkingIndex = contentBlocks.findIndex(b => b.type === 'thinking')
            if (thinkingIndex === -1) {
              const block = { type: 'thinking', thinking: '', signature: '' }
              contentBlocks.push(block)
              yield {
                type: 'content_block_start',
                index: contentBlocks.length - 1,
                content_block: { type: 'thinking', thinking: '' },
              }
            }
            const tIdx = contentBlocks.findIndex(b => b.type === 'thinking')
            yield {
              type: 'content_block_delta',
              index: tIdx,
              delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
            }
          }

          // 工具调用 → tool_use content_block
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                // 新的 tool_call 开始 → content_block_start
                const block = {
                  type: 'tool_use',
                  id: tc.id ?? `toolu_${String(toolUseIdCounter++).padStart(24, '0')}`,
                  name: tc.function.name,
                  input: '',
                }
                contentBlocks.push(block)
                currentToolUseIndex = contentBlocks.length - 1
                yield {
                  type: 'content_block_start',
                  index: currentToolUseIndex,
                  content_block: {
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: {},
                  },
                }
              }
              if (tc.function?.arguments && currentToolUseIndex >= 0) {
                // tool_call 参数增量 → input_json_delta
                yield {
                  type: 'content_block_delta',
                  index: currentToolUseIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }

          // finish_reason → message_delta + message_stop
          if (choice.finish_reason) {
            // 先关闭未关闭的 content blocks
            // ... (关闭 text block 等)

            const stopReasonMap: Record<string, string> = {
              stop: 'end_turn',
              tool_calls: 'tool_use',
              length: 'max_tokens',
              content_filter: 'end_turn',
            }

            usage.output_tokens = chunk.usage?.completion_tokens ?? 0

            yield {
              type: 'message_delta',
              delta: {
                stop_reason: stopReasonMap[choice.finish_reason] ?? 'end_turn',
              },
              usage: { output_tokens: usage.output_tokens },
            }
            yield { type: 'message_stop' }
          }
        } catch {
          // 忽略无法解析的 JSON 行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
```

***

### 阶段 4：Gemini 兼容适配器

**新建文件**: `src/services/api/geminiCompat.ts`

Gemini 的 API 格式与 Anthropic/OpenAI 差异更大，需要独立的转换逻辑：

```typescript
export function convertAnthropicRequestToGemini(params: {
  system: SystemPromptBlock[]
  messages: BetaMessageParam[]
  tools: BetaToolUnion[]
  max_tokens: number
  model: string
}): { url: string; body: object } {
  // Gemini 使用 contents[] 格式
  // system → systemInstruction
  // messages → contents (role: "user" | "model")
  // tools → tools[].functionDeclarations

  // 认证使用 x-goog-api-key Header（非 Bearer Token）
  // 端点路径: /models/{model}:streamGenerateContent?alt=sse

  // ... 具体转换逻辑
}

export async function* createGeminiCompatStream(params: {
  params: AnthropicRequestParams
  apiKey: string
  baseURL: string
  model: string
  signal: AbortSignal
}): AsyncGenerator<AnthropicStreamEvent | AssistantMessage> {
  // 与 OpenAI 类似的模式，但需要处理 Gemini 特有的 SSE 格式
  // ...
}
```

***

### 阶段 5：认证流程与交互式配置

#### 5.1 API Key 获取逻辑

**文件**: `src/utils/auth.ts`

在 `getAnthropicApiKeyWithSource()` 中新增 `DOGE_API_KEY` 读取：

```typescript
// 在优先级链中新增（在 ANTHROPIC_API_KEY 之后）
if (process.env.DOGE_API_KEY && getCompatProvider() !== 'anthropic') {
  return { key: process.env.DOGE_API_KEY, source: 'DOGE_API_KEY' }
}
```

#### 5.2 交互式配置 UI

**文件**: `src/components/ConsoleOAuthFlow.tsx`

在现有的认证选择界面中，新增 **"自定义 API 接入"** 选项：

```tsx
// 在认证方式选择列表中新增
{
  label: '自定义 API 接入 (OpenAI Compatible)',
  description: '接入 GLM、Kimi、DeepSeek、Qwen、Ollama 等',
  value: 'custom-api',
}

// 新增配置输入界面
const CustomApiConfigScreen = () => (
  <Box flexDirection="column">
    <Text bold>配置自定义 API</Text>

    <Text>Provider 类型:</Text>
    <SelectInput items={[
      { label: 'OpenAI Compatible', value: 'openai' },
      { label: 'Gemini', value: 'gemini' },
    ]} />

    <Text>Base URL (不带 /chat/completions):</Text>
    <TextInput value={baseURL} onChange={setBaseURL} />

    <Text>API Key:</Text>
    <TextInput value={apiKey} onChange={setApiKey} mask="*" />

    <Text>Model 名称:</Text>
    <TextInput value={model} onChange={setModel} />

    <Text>
      <Text color="green">配置将保存到 ~/.claude/.claude.json</Text>
    </Text>
  </Box>
)
```

***

### 阶段 6：命令与管理

#### 6.1 新增 `/add-model` 命令

**新建文件**: `src/commands/addModel.ts`

```typescript
export const addModelCommand: Command = {
  type: 'local',
  name: 'add-model',
  description: '添加自定义模型到已保存列表',
  isEnabled: true,
  isHidden: false,
  userFacingName: () => 'add-model',
  getArguments: () => [{ name: 'model', description: '模型名称' }],
  async execute(context, args) {
    const modelName = args[0]
    if (!modelName) return '请提供模型名称'

    const config = getMergedCustomApiConfig()
    const savedModels = [...(config.savedModels ?? [])]
    if (!savedModels.includes(modelName)) {
      savedModels.push(modelName)
    }

    writeCustomApiStorage({ ...config, savedModels })
    process.env.ANTHROPIC_MODEL = modelName

    return `已添加模型: ${modelName}`
  },
}
```

#### 6.2 注册命令

**文件**: `src/commands.ts`

在命令注册表中新增：

```typescript
import { addModelCommand } from './commands/addModel'

// 在 COMMANDS() 中新增
addModelCommand,
```

***

## 五、格式映射参考

### 5.1 消息格式映射（Anthropic ↔ OpenAI）

| 概念           | Anthropic 格式                                         | OpenAI 兼容格式                                           |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| **文本内容**     | `content: [{ type: 'text', text: '...' }]`           | `content: '...'`                                      |
| **Tool 调用**  | `content: [{ type: 'tool_use', id, name, input }]`   | `tool_calls: [{ id, function: { name, arguments } }]` |
| **Tool 结果**  | `{ type: 'tool_result', tool_use_id, content }`      | `{ role: 'tool', tool_call_id, content }`             |
| **Thinking** | `{ type: 'thinking', thinking, signature }`          | `delta.reasoning_content`（DeepSeek-R1）                |
| **System**   | `system: [{ type: 'text', text }]`                   | `messages: [{ role: 'system', content }]`             |
| **图片**       | `{ type: 'image', source: { type: 'base64', ... } }` | `{ type: 'image_url', image_url: { url } }`           |

### 5.2 Tool Schema 映射

| 字段             | Anthropic                             | OpenAI                                                              |
| -------------- | ------------------------------------- | ------------------------------------------------------------------- |
| **工具定义**       | `{ name, description, input_schema }` | `{ type: 'function', function: { name, description, parameters } }` |
| **Schema 字段名** | `input_schema`                        | `parameters`                                                        |
| **工具选择**       | `tool_choice: { type: 'auto' }`       | `tool_choice: 'auto'`                                               |

### 5.3 流式事件映射

| 事件          | Anthropic SSE                              | OpenAI SSE                                          |
| ----------- | ------------------------------------------ | --------------------------------------------------- |
| **消息开始**    | `event: message_start`                     | 首个 `data: {"choices":[...]}`                        |
| **文本增量**    | `content_block_delta` + `text_delta`       | `choices[0].delta.content`                          |
| **Tool 增量** | `content_block_delta` + `input_json_delta` | `choices[0].delta.tool_calls[0].function.arguments` |
| **推理增量**    | `content_block_delta` + `thinking_delta`   | `choices[0].delta.reasoning_content`                |
| **结束原因**    | `message_delta.delta.stop_reason`          | `choices[0].finish_reason`                          |
| **流结束**     | `event: message_stop`                      | `data: [DONE]`                                      |

### 5.4 Stop Reason 映射

| Anthropic       | OpenAI       | 含义          |
| --------------- | ------------ | ----------- |
| `end_turn`      | `stop`       | 正常结束        |
| `tool_use`      | `tool_calls` | 需要调用工具      |
| `max_tokens`    | `length`     | 达到 token 上限 |
| `stop_sequence` | `stop`       | 命中停止序列      |

***

## 六、关键风险与注意事项

### 6.1 需要丢弃的 Anthropic 专有功能

接入第三方模型时，以下功能**无法映射**，需要在转换时条件跳过：

| 功能                               | 处理方式                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| `cache_control` (Prompt Caching) | 请求转换时移除该字段                                                 |
| `thinking` (Extended Thinking)   | 请求时不发送；如果模型支持推理（如 DeepSeek-R1），通过 `reasoning_content` 反向映射 |
| `redacted_thinking`              | 直接忽略                                                       |
| `server_tool_use`                | 不支持，转换时跳过                                                  |
| `defer_loading` (Tool Search)    | 请求转换时移除                                                    |
| `speed: 'fast'`                  | 请求转换时移除                                                    |
| `betas` headers                  | 请求转换时移除                                                    |
| `effort` 配置                      | 请求转换时移除                                                    |

### 6.2 必须处理的兼容性问题

| 问题                       | 说明                                                      | 解决方案                                            |
| ------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| **多 Tool 并行调用**          | Anthropic 支持一次返回多个 `tool_use`，OpenAI 也支持多个 `tool_calls` | 格式映射时保持数组结构                                     |
| **Streaming Tool Input** | JSON 参数增量传输方式不同                                         | `input_json_delta` ↔ `function.arguments` 逐字符映射 |
| **错误格式**                 | 不同 API 的错误响应格式完全不同                                      | 统一转换为 Anthropic 的错误类型                           |
| **Token 计数**             | 不同模型的 tokenizer 不同                                      | 使用 API 返回的 usage 数据，不做本地估算                      |
| **最大 Token**             | 不同模型的 `max_tokens` 上限不同                                 | 根据模型配置动态调整                                      |

### 6.3 模型能力差异

不是所有第三方模型都支持 Tool Use。接入时需要确认：

- ✅ GLM-4 系列 — 完整 Function Calling 支持
- ✅ DeepSeek-Chat — 完整 Function Calling 支持
- ✅ DeepSeek-Reasoner — 推理 + Function Calling
- ✅ Qwen-Plus/Max — 完整 Function Calling 支持
- ✅ Kimi (Moonshot) — 完整 Function Calling 支持
- ⚠️ Ollama 本地模型 — 取决于具体模型，部分模型不支持

***

## 七、测试验证方案

### 7.1 单元测试

```
tests/
├── openaiCompat.test.ts
│   ├── convertAnthropicRequestToOpenAI()
│   │   ├── 文本消息转换
│   │   ├── tool_use → tool_calls 转换
│   │   ├── tool_result → tool role 转换
│   │   ├── system prompt 提取
│   │   └── input_schema → parameters 转换
│   │
│   └── createAnthropicStreamFromOpenAI()
│       ├── text delta → text_delta 转换
│       ├── tool_calls → tool_use + input_json_delta 转换
│       ├── reasoning_content → thinking_delta 转换
│       ├── finish_reason → stop_reason 映射
│       └── error handling
│
├── geminiCompat.test.ts
│   └── (类似结构)
│
└── customApiStorage.test.ts
    ├── 配置读写
    ├── 优先级合并
    └── Provider 判定
```

### 7.2 集成测试步骤

```bash
# 1. 安装依赖并构建
bun install && bun run build:dev

# 2. 测试 DeepSeek 接入
export ANTHROPIC_BASE_URL="https://api.deepseek.com"
export DOGE_API_KEY="sk-test-key"
export ANTHROPIC_MODEL="deepseek-chat"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"

./cli-dev -p "hello, 你能使用 Bash 工具吗？"

# 3. 测试 Ollama 本地模型
export ANTHROPIC_BASE_URL="http://localhost:11434/v1"
export DOGE_API_KEY="ollama"
export ANTHROPIC_MODEL="qwen2.5-coder:7b"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"

./cli-dev -p "列出当前目录的文件"

# 4. 测试 Tool Use
./cli-dev -p "帮我创建一个 hello.py 文件，内容是 print('hello world')"

# 5. 验证流式输出
./cli-dev -p "用中文解释什么是递归"  # 观察流式文本输出是否正常

# 6. 恢复 Anthropic 原生路径
unset CLAUDE_CODE_COMPATIBLE_API_PROVIDER
unset DOGE_API_KEY
./cli-dev -p "hello"  # 应正常走 Anthropic API
```

### 7.3 验证清单

- [ ] 环境变量配置后能正确识别 Provider 类型
- [ ] Anthropic 原生路径未受影响（回归测试）
- [ ] OpenAI 兼容路径能发送请求并接收流式响应
- [ ] 文本流式输出正常显示
- [ ] Tool Use 请求正确发送并被模型识别
- [ ] Tool Result 正确回传给模型
- [ ] 多轮 Tool 调用循环正常工作
- [ ] 错误响应被正确捕获和显示
- [ ] Thinking/推理内容正确展示（DeepSeek-R1）
- [ ] 配置持久化后重启会话仍然生效
- [ ] 交互式配置 UI 正常工作

***

## 附录：各模型快速配置速查表

| 模型          | `ANTHROPIC_BASE_URL`                                | `ANTHROPIC_MODEL`   | 备注                    |
| ----------- | --------------------------------------------------- | ------------------- | --------------------- |
| DeepSeek    | `https://api.deepseek.com`                          | `deepseek-chat`     | 推荐首选测试                |
| DeepSeek-R1 | `https://api.deepseek.com`                          | `deepseek-reasoner` | 支持 reasoning\_content |
| GLM-4       | `https://open.bigmodel.cn/api/paas/v4`              | `glm-4-flash`       | 免费额度                  |
| Kimi        | `https://api.moonshot.cn/v1`                        | `moonshot-v1-8k`    | 长上下文                  |
| Qwen        | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`         | 阿里云                   |
| Ollama      | `http://localhost:11434/v1`                         | `qwen2.5-coder:7b`  | 本地部署                  |
| Gemini      | `https://generativelanguage.googleapis.com/v1beta`  | `gemini-2.5-pro`    | 需 gemini 适配器          |

