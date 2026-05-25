# query.ts 测试规划与类型修复方案

**文件**: `src/query.ts` (1,729 行)
**版本**: 2.1.91
**日期**: 2026-05-25

---

## 目录

1. [现状分析](#一现状分析)
2. [类型缺陷清单](#二类型缺陷清单)
3. [测试规划](#三测试规划)
4. [类型修复方案](#四类型修复方案)
5. [实施顺序](#五实施顺序)
6. [附录：Terminal 类型设计](#附录terminal--continue-类型设计)

---

## 一、现状分析

### 1.1 模块职责

`query.ts` 是 latte 的**核心查询循环**，负责：

```
用户消息
  → query() 入口
    → queryLoop() 循环
      → 消息预处理（snip、microcompact、context collapse）
      → 自动压缩（autoCompact）
      → API 流式调用（callModel）
      → 工具解析与流式执行（StreamingToolExecutor / runTools）
      → 错误恢复（prompt-too-long、max-output-tokens、model fallback）
      → Token 预算管理
      → 附件注入（文件变更、记忆、技能发现）
      → 循环继续 或 返回 Terminal 结果
```

### 1.2 函数结构

| 函数 | 行号 | 类型 | 职责 |
|------|------|------|------|
| `yieldMissingToolResultBlocks` | 123-149 | 生成器 | 为缺失 tool_result 的 tool_use 填充错误消息 |
| `isWithheldMaxOutputTokens` | 175-179 | 函数 | 判断消息是否应暂缓输出 |
| `query()` | 219-239 | `AsyncGenerator` | 公共入口，包装 queryLoop |
| `queryLoop()` | 241-1729 | `AsyncGenerator` | 核心查询循环 |

### 1.3 状态机设计

```typescript
type State = {
  messages: Message[]                    // 累积消息
  toolUseContext: ToolUseContext          // 工具上下文（每轮更新）
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number    // 输出 token 恢复计数
  hasAttemptedReactiveCompact: boolean    // 是否尝试过反应式压缩
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined       // 上一轮循环的持续原因
}
```

**状态转换图**（10 种 `Continue` 分支 + 11 种 `Terminal` 出口）：

```
                    ┌──────────────────────────────┐
                    │        queryLoop 入口          │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼──────────────────────┐
              ▼                    ▼                      ▼
        blocking_limit         API streaming        model error / image error
        (prompt过长)             ▼                  (异常退出)
                          ┌──────────────┐
                          │ 流式响应接收  │
                          └──────┬───────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              ▼                  ▼                      ▼
       abort (用户中断)    needsFollowUp=false    needsFollowUp=true
       → aborted_streaming   (无tool_use)         (有tool_use)
                                 │                      │
                    ┌────────────┼────────────┐         │
                    ▼            ▼            ▼         │
              completed    stop_hook    prompt_too_long  │
                           _prevented   → max_tokens_    │
                                        escalate         │
                                        → max_tokens_    │
                                        recovery         │
                                        → reactive_      │
                                        compact_retry    │
                                        → collapse_      │
                                        drain_retry      │
                                                         │
                                                         ▼
                                                  工具执行 & 附件注入
                                                         │
                                              ┌──────────┼──────────┐
                                              ▼          ▼          ▼
                                         abort      hook_    max_turns
                                         → aborted  stopped
                                         _tools
                                                         │
                                                         ▼
                                                  token_budget
                                                  continuation / completed
                                                         │
                                                         ▼
                                                     next_turn
```

### 1.4 依赖关系

```
query.ts
├── [DI] QueryDeps (deps.ts) ───────── 4 个可注入依赖
│   ├── callModel: queryModelWithStreaming (services/api/claude.ts)
│   ├── microcompact: microcompactMessages (services/compact/microCompact.ts)
│   ├── autocompact: autoCompactIfNeeded (services/compact/autoCompact.ts)
│   └── uuid: randomUUID
│
├── [Feature Flag] 动态依赖 (require() 延迟加载)
│   ├── snipModule (HISTORY_SNIP)
│   ├── reactiveCompact (REACTIVE_COMPACT)
│   ├── contextCollapse (CONTEXT_COLLAPSE)
│   ├── skillPrefetch (EXPERIMENTAL_SKILL_SEARCH)
│   ├── taskSummaryModule (BG_SESSIONS)
│   └── jobClassifier (TEMPLATES)
│
├── [Static] 核心依赖
│   ├── @anthropic-ai/sdk (ToolResultBlockParam, ToolUseBlock)
│   ├── Tool.ts (findToolByName, ToolUseContext, ToolUseContext)
│   ├── query/config.ts (buildQueryConfig, QueryConfig)
│   ├── query/deps.ts (QueryDeps, productionDeps)
│   ├── query/transitions.ts ⚠️ 文件缺失
│   ├── query/stopHooks.ts (handleStopHooks)
│   ├── query/tokenBudget.ts (createBudgetTracker, checkTokenBudget)
│   ├── types/message.ts (各种 Message 类型)
│   ├── utils/messages.ts (8 个消息创建/过滤函数)
│   ├── utils/attachments.ts (4 个附件函数)
│   └── 30+ 其他导入
```

---

## 二、类型缺陷清单

### 2.1 致命：`src/query/transitions.ts` 文件缺失

```typescript
// query.ts:104
import type { Terminal, Continue } from './query/transitions.js'
```

**问题**: `Terminal` 和 `Continue` 是核心类型（State.transition 和生成器返回值），但定义文件不存在。

**影响**: 
- 类型 `Terminal` 和 `Continue` 在任何 TypeScript 编译中均无法解析
- 23 个 `return` 语句和 7 个 `state.transition` 赋值均缺少类型约束
- 新增出口路径时无类型检查保护，极易遗漏处理

**根因分析**: `query/deps.ts` 注释中提到 "Followup PRs can add runTools, handleStopHooks, logEvent, queue ops, etc."，说明 `transitions.ts` 是计划中但尚未创建的文件。这是一个**未完成的架构重构**。

---

### 2.2 严重：类型安全缺口

| 位置 | 行号 | 代码 | 问题 |
|------|------|------|------|
| `yieldMessage` | 747 | `let yieldMessage: typeof message = message` | `typeof message` 是运行时值类型推断，但 `message` 来自迭代器，类型过于宽泛 |
| `usage` cast | 876-877 | `(usage as unknown as Record<string, number>)` | 绕过类型检查访问可能不存在的字段 |
| `errorMessage` | 958 | `error instanceof Error ? error.message : String(error)` | `error` 是 `unknown`（catch 块），无类型守卫 |
| `content` cast | 130-131 | `content => content.type === 'tool_use') as ToolUseBlock[]` | 类型断言替代类型守卫，运行时无验证 |
| `message.type` 比较 | 748 | `if (message.type === 'assistant')` | 使用字符串字面量而非类型守卫，易出错 |
| `block.input` | 754 | `typeof block.input === 'object' && block.input !== null` | 使用 `typeof === 'object'` 而非更精确的 Zod 验证 |
| `AnalyticsMetadata` 类型断言 | 358 | `queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` | `string` 强制转换为窄类型，绕过类型检查 |
| `innerError.originalModel` | 934 | `innerError.originalModel as AnalyticsMetadata...` | `FallbackTriggeredError` 属性的类型断言 |
| `toolUseContext.abortController.signal.reason` | 1046 | `signal.reason !== 'interrupt'` | `reason` 字段不属于 `AbortSignal` 标准 API，类型不安全 |
| `lastMessage.at(-1)` | 1063 | `const lastMessage = assistantMessages.at(-1)` | 返回类型是 `AssistantMessage | undefined`，后续访问未做空值检查 |

### 2.3 中等：Feature Flag 分支导致的类型不确定性

```typescript
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import(...))
  : null
```

**问题**:
- 14 个 Feature Flag 分支，每个分支内类型由 `as` 断言提供
- `null` 分支代码路径的 `!` 非空断言（如 `snipModule!`）依赖于 feature flag 的编译时保证
- 如果 feature flag 配置错误（运行时启用但编译时未注入），TypeScript 无法捕获

### 2.4 类型统计

| 指标 | 数量 |
|------|------|
| `as` 类型断言 | 27+ |
| `typeof` 类型推断 | 3 |
| `any` 隐式（通过 `as`/`unknown` 传递） | 15+ |
| 未定义类型（transitions.ts 缺失） | 2 个核心类型 |
| Feature Flag 条件中的 `!` 非空断言 | 8+ |

---

## 三、测试规划

### 3.1 测试框架

推荐使用 **Vitest**，理由：
- 原生 ES Module 支持（与项目的 `"type": "module"` 兼容）
- Bun 兼容（可通过 `bun test` 运行或使用 vitest runner）
- 丰富的 mock 功能（`vi.fn()`、`vi.mock()`）
- 并行测试支持

```bash
# 安装
bun add -d vitest

# 运行
bunx vitest src/query/__tests__/
```

### 3.2 Mock 策略

`query.ts` 已有 `QueryDeps` 依赖注入接口（4 个依赖），可直接注入 mock 实现：

```typescript
// 为每个测试用例创建干净的 mock 环境
function createMockDeps(overrides: Partial<QueryDeps> = {}): QueryDeps {
  return {
    callModel: vi.fn().mockImplementation(async function*() { /* no-op */ }),
    microcompact: vi.fn().mockResolvedValue({ messages: [], compactionInfo: undefined }),
    autocompact: vi.fn().mockResolvedValue({ wasCompacted: false }),
    uuid: vi.fn().mockReturnValue('test-uuid'),
    ...overrides,
  }
}
```

**需要额外 Mock 的外部依赖**（这些不在 QueryDeps 中，需要 vi.mock）：

| 模块 | mock 策略 | 原因 |
|------|-----------|------|
| `bun:bundle` / `feature()` | `vi.mock('bun:bundle', () => ({ feature: () => false }))` | 关闭所有 Feature Flag |
| `bootstrap/state.js` | `vi.mock` 返回固定值 | 隔离 session/context 状态 |
| `utils/messages.ts` | spy 关键函数 | `createUserMessage`、`normalizeMessagesForAPI` 等 |
| `utils/attachments.ts` | mock 返回空数组 | 附件注入不是 query 循环核心 |
| `services/tools/StreamingToolExecutor.js` | mock 类 | 工具执行是外部模块 |
| `services/analytics/index.js` / `logEvent` | `vi.fn()` | 不需要真正发送事件 |
| `services/analytics/growthbook.js` | mock 返回 false | 不需要 GrowthBook |
| `utils/array.js` / `count` | 保留真实实现 | 纯函数无副作用 |

### 3.3 测试辅助工厂函数

```typescript
// 创建最小可用的 ToolUseContext
function createMinimalToolUseContext(
  overrides: Partial<ToolUseContext> = {}
): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-20250514',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allowedAgentTypes: [], agents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({} as AppState),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

// 创建最小可用的 QueryParams
function createMinimalParams(
  overrides: Partial<QueryParams> = {}
): QueryParams {
  return {
    messages: [],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    toolUseContext: createMinimalToolUseContext(),
    querySource: 'test' as QuerySource,
    deps: createMockDeps(),
    ...overrides,
  }
}

// 创建模拟的 AssistantMessage
function createMockAssistantMessage(opts: {
  text?: string
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>
} = {}): StreamEvent {
  return {
    type: 'assistant',
    uuid: 'msg-uuid',
    message: {
      id: 'msg-id',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [
        ...(opts.text ? [{ type: 'text' as const, text: opts.text }] : []),
        ...(opts.toolUses ?? []).map(tu => ({
          type: 'tool_use' as const,
          id: tu.id,
          name: tu.name,
          input: tu.input,
        })),
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: opts.toolUses?.length ? 'tool_use' : 'end_turn',
    },
  } as StreamEvent
}
```

### 3.4 测试用例设计

#### 3.4.1 核心流程测试（P0 - 最高优先级）

| 测试ID | 场景 | 验证点 |
|--------|------|--------|
| Q-001 | 无 tool_use 的简单完成 | `completed` Terminal，yield 正确的 assistant message |
| Q-002 | 单 tool_use → 工具执行 → 完成 | 工具执行后发起第二次 API 调用，两轮后 `completed` |
| Q-003 | 多 tool_use 并发 | 所有工具并发执行，结果正确聚合 |
| Q-004 | 空消息列表 | 能否正常启动循环（不崩溃） |
| Q-005 | 用户中断（abort streaming） | `aborted_streaming` Terminal，yield 中断消息 |
| Q-006 | 用户中断（abort during tools） | `aborted_tools` Terminal |

**测试代码示例**：

```typescript
describe('query() core flow', () => {
  it('Q-001: completes without tool_use', async () => {
    const deps = createMockDeps()
    deps.callModel.mockImplementation(async function*() {
      yield createMockAssistantMessage({ text: 'Hello!' })
    })

    const params = createMinimalParams({ deps })
    const results: unknown[] = []

    for await (const event of query(params)) {
      results.push(event)
    }

    // 验证 yield 了 stream_request_start 和 assistant message
    expect(results.some(r => r.type === 'stream_request_start')).toBe(true)
    expect(results.some(r => r.type === 'assistant')).toBe(true)
    expect(results.some(r => r.type === 'tombstone')).toBe(false)
  })

  it('Q-002: tool_use triggers follow-up API call', async () => {
    const deps = createMockDeps()
    let callCount = 0
    deps.callModel.mockImplementation(async function*() {
      callCount++
      if (callCount === 1) {
        yield createMockAssistantMessage({
          toolUses: [{ id: 'tu-1', name: 'Bash', input: { command: 'ls' } }],
        })
        // yield tool result via streaming executor
      } else {
        yield createMockAssistantMessage({ text: 'Done!' })
      }
    })
    // ... verify two API calls
    expect(callCount).toBe(2)
  })
})
```

#### 3.4.2 状态转换测试（P0）

| 测试ID | 场景 | Continue reason | 验证点 |
|--------|------|-----------------|--------|
| T-001 | 正常多轮循环 | `next_turn` | State 正确更新，消息累积 |
| T-002 | max_output_tokens → 升级 | `max_output_tokens_escalate` | maxOutputTokensOverride 被设置 |
| T-003 | max_output_tokens → 恢复 | `max_output_tokens_recovery` | 恢复消息注入，count 递增 |
| T-004 | max_output_tokens → 耗尽 | n/a（返回 Terminal） | 3 次恢复后错误浮出 |
| T-005 | prompt-too-long → collapse drain | `collapse_drain_retry` | contextCollapse.recoverFromOverflow 被调用 |
| T-006 | prompt-too-long → reactive compact | `reactive_compact_retry` | reactiveCompact.tryReactiveCompact 被调用 |
| T-007 | prompt-too-long → 无恢复 | n/a（返回 Terminal） | 错误消息被 yield |
| T-008 | stop_hook blocking | `stop_hook_blocking` | stopHookActive 被设为 true |
| T-009 | token_budget → continue | `token_budget_continuation` | nudge 消息注入 |
| T-010 | token_budget → diminished | n/a（返回 Terminal） | completionEvent.diminishingReturns |

#### 3.4.3 错误处理测试（P0）

| 测试ID | 场景 | 验证点 |
|--------|------|--------|
| E-001 | API 抛出 FallbackTriggeredError | fallbackModel 被切换，所有消息被清理后重试 |
| E-002 | API 抛出普通 Error | yield 错误消息，返回 `model_error` Terminal |
| E-003 | API 抛出 ImageSizeError | yield 友好错误，返回 `image_error` Terminal |
| E-004 | API 抛出 ImageResizeError | 同上 |
| E-005 | 流式回退后 API 重试 | 孤儿消息被 tombstone，executor 重建 |

#### 3.4.4 附件注入测试（P1）

| 测试ID | 场景 | 验证点 |
|--------|------|--------|
| A-001 | 文件变更附件注入 | file change attachments 被 yield |
| A-002 | 记忆附件注入 | memory prefetch 结果被注入 |
| A-003 | 技能发现附件注入 | skill discovery 结果被注入 |
| A-004 | 命令快照注入 | queued commands 被转化为附件 |
| A-005 | 工具使用摘要生成 | tool_use_summary 在下一轮 yield |

#### 3.4.5 消息处理测试（P1）

| 测试ID | 场景 | 验证点 |
|--------|------|--------|
| M-001 | 消息前置 userContext | prependUserContext 被调用 |
| M-002 | 消息追加 systemContext | appendSystemContext 在 systemPrompt 上调用 |
| M-003 | 工具结果预算裁剪 | applyToolResultBudget 被调用 |
| M-004 | 内容替换持久化 | recordContentReplacement 被调用 |
| M-005 | backfillObservableInput | tool_use 输入被回填后重新 yield |

#### 3.4.6 权限与安全检查（P1）

| 测试ID | 场景 | 验证点 |
|--------|------|--------|
| S-001 | blocking_limit 触发 | prompt 过长时返回 `blocking_limit` |
| S-002 | 压缩后不触发 blocking_limit | compactionResult 存在时跳过检查 |
| S-003 | compact/session_memory source 不触发 | 压缩查询不检查 blocking_limit |
| S-004 | max_turns 限制 | 达到限制时返回 `max_turns` |

#### 3.4.7 Feature Flag 行为测试（P2）

| 测试ID | Feature | 验证点 |
|--------|---------|--------|
| F-001 | HISTORY_SNIP | snip 被调用，边界消息被 yield |
| F-002 | TOKEN_BUDGET | budgetTracker 创建，checkTokenBudget 执行 |
| F-003 | BG_SESSIONS | taskSummary 被触发 |
| F-004 | CHICAGO_MCP | abort 时 cleanupComputerUseAfterTurn 被调用 |

### 3.5 测试覆盖率目标

| 模块 | 目标覆盖率 | 说明 |
|------|------------|------|
| `query()` 函数 | 100% | 仅 20 行，易于覆盖 |
| `queryLoop()` 主循环路径 | 90%+ | 核心逻辑 |
| 错误处理分支 | 100% | catch 块全部分覆盖 |
| 状态转换 | 100% | 所有 Continue/Terminal 变体 |
| Feature Flag 分支 | 按启用的 flag 覆盖 | 构建矩阵中的每个 flag 组合 |

### 3.6 测试文件结构

```
src/query/
├── __tests__/
│   ├── query.core.test.ts       # P0: 核心流程
│   ├── query.transitions.test.ts # P0: 状态转换
│   ├── query.errors.test.ts     # P0: 错误处理
│   ├── query.attachments.test.ts # P1: 附件注入
│   ├── query.messages.test.ts   # P1: 消息处理
│   ├── query.security.test.ts   # P1: 权限与安全
│   ├── query.features.test.ts   # P2: Feature Flag
│   └── helpers/
│       ├── mock-factory.ts      # Mock 工厂函数
│       ├── mock-deps.ts         # QueryDeps mock
│       └── mock-context.ts      # ToolUseContext mock
```

---

## 四、类型修复方案

### 4.1 第 0 步：创建 `src/query/transitions.ts` (CRITICAL)

**当前状态**: 文件不存在，导致 `Terminal` 和 `Continue` 类型无法解析。

**方案**:

```typescript
// src/query/transitions.ts

/**
 * Terminal states — query loop exit reasons.
 * Yielded as the return value of the AsyncGenerator.
 */
export type Terminal =
  | { reason: 'completed' }
  | { reason: 'aborted_streaming' }
  | { reason: 'aborted_tools' }
  | { reason: 'blocking_limit' }
  | { reason: 'max_turns'; turnCount: number }
  | { reason: 'image_error' }
  | { reason: 'prompt_too_long' }
  | { reason: 'hook_stopped' }
  | { reason: 'stop_hook_prevented' }
  | { reason: 'model_error'; error?: unknown }
  | { reason: 'token_budget_completed' }

/**
 * Continue signals — why the loop decided to iterate again.
 * Stored on State.transition for test assertions and debugging.
 */
export type Continue =
  | { reason: 'next_turn' }
  | { reason: 'collapse_drain_retry'; committed: number }
  | { reason: 'reactive_compact_retry' }
  | { reason: 'max_output_tokens_escalate' }
  | { reason: 'max_output_tokens_recovery'; attempt: number }
  | { reason: 'stop_hook_blocking' }
  | { reason: 'token_budget_continuation' }
```

**验证**: 创建此文件后，23 个 `return` 语句和 7 个 `state = { ... transition: ... }` 赋值将自动获得类型检查。任一新出口路径缺少字段或拼写错误将立即报错。

---

### 4.2 第 1 步：收紧 State 类型的可变性语义

```typescript
// 当前
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  // ...
}

// 修复后：区分只读和可变字段
type State = {
  // 循环内可变（在多个 continue site 处重新赋值）
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined

  // 单调递增（只增不减）
  maxOutputTokensRecoveryCount: number
  turnCount: number

  // 布尔标记（循环维度）
  hasAttemptedReactiveCompact: boolean
  stopHookActive: boolean | undefined

  // 覆盖值（可重置）
  maxOutputTokensOverride: number | undefined

  // 异步产物
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined

  // 诊断
  transition: Continue | undefined
}
```

**收益**: 文档化每个字段的语义，为后续拆分做准备。

---

### 4.3 第 2 步：消除内部 `any` 和类型断言

#### 2a. `yieldMessage` 类型问题 (行 747)

```typescript
// 当前
let yieldMessage: typeof message = message  // typeof 来自运行时值，不可靠

// 修复：直接使用 StreamEvent | Message 联合，无中间变量
// 如果 backfill 需要修改，则创建显式类型克隆
if (message.type === 'assistant' && needsBackfill(message)) {
  const backfilled: StreamEvent = applyBackfill(message, tools)
  yield backfilled
} else {
  yield message
}
```

#### 2b. `usage` 不安全访问 (行 876-877)

```typescript
// 当前
const cumulativeDeleted = usage
  ? ((usage as unknown as Record<string, number>).cache_deleted_input_tokens ?? 0)
  : 0

// 修复：在 Usage 类型上添加可选字段
// 方案 1: 如果 API 返回的类型有定义，扩展它
type UsageWithCacheDelete = NonNullableUsage & {
  cache_deleted_input_tokens?: number
}

// 方案 2: 使用类型安全的安全访问
function getCacheDeletedTokens(usage: unknown): number {
  if (typeof usage === 'object' && usage !== null && 'cache_deleted_input_tokens' in usage) {
    return Number((usage as Record<string, unknown>).cache_deleted_input_tokens) || 0
  }
  return 0
}
```

#### 2c. `tool_use` 内容过滤 (行 130-131)

```typescript
// 当前
const toolUseBlocks = message.message.content.filter(
  content => content.type === 'tool_use',
) as ToolUseBlock[]

// 修复：使用类型守卫
function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use'
}
const toolUseBlocks = message.message.content.filter(isToolUseBlock)
```

**注意**: 需要在 `src/types/message.ts` 中导入 `ContentBlock` 类型。

#### 2d. `signal.reason` 扩展 (行 1046)

```typescript
// 当前：访问不存在的属性
if (toolUseContext.abortController.signal.reason !== 'interrupt')

// 修复：定义扩展类型
type AbortSignalWithReason = AbortSignal & { reason?: string }

function getAbortReason(signal: AbortSignal): string | undefined {
  return (signal as AbortSignalWithReason).reason
}

// 使用
if (getAbortReason(toolUseContext.abortController.signal) !== 'interrupt')
```

#### 2e. `AnalyticsMetadata` 类型断言 (多处)

```typescript
// 当前（行 358）
queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

// 修复：在常量文件中定义品牌类型
type AnalyticsChainId = string & { readonly __brand: 'AnalyticsChainId' }

// 然后使用窄化函数而非类型断言
function asAnalyticsChainId(id: string): AnalyticsChainId {
  return id as AnalyticsChainId
}
```

#### 2f. `innerError` 不安全属性访问 (行 934)

```typescript
// 当前
innerError.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

// 修复
if (innerError instanceof FallbackTriggeredError) {
  const originalModel: string = innerError.originalModel
  // 类型系统现在知道 originalModel 存在
}
```

---

### 4.4 第 3 步：Feature Flag 类型安全

```typescript
// 当前（每个 feature flag 分支都是独立模式）
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import(...))
  : null

// --- 使用处 ---
if (feature('HISTORY_SNIP')) {
  const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)  // ! 不安全
}

// 修复：统一 gate 模式
type FeatureGates = {
  historySnip: boolean
  reactiveCompact: boolean
  contextCollapse: boolean
  // ...
}

function gate<T>(flag: boolean, fn: () => T): T | null {
  return flag ? fn() : null
}

// 使用
const snipModule = gate(feature('HISTORY_SNIP'), () => 
  require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js')
)
if (snipModule) {
  const result = snipModule.snipCompactIfNeeded(messagesForQuery)  // 类型安全
}
```

### 4.5 第 4 步：拆分 `queryLoop` 为更小的函数

当前的 `queryLoop` 函数 1729 行，包含 7 个独立阶段。建议拆分为：

```typescript
// 阶段函数类型签名
type LoopPhase = {
  // 阶段 1: 预处理
  preprocess: (
    messages: Message[],
    toolUseContext: ToolUseContext,
    querySource: QuerySource,
    config: QueryConfig,
  ) => Promise<{
    messages: Message[]
    yields: (Message | StreamEvent)[]
    autoCompactTracking?: AutoCompactTrackingState
    taskBudgetRemaining?: number
  }>

  // 阶段 2: API 调用
  callAPI: (
    messages: Message[],
    systemPrompt: SystemPrompt,
    userContext: Ctx,
    systemContext: Ctx,
    toolUseContext: ToolUseContext,
    config: QueryConfig,
    deps: QueryDeps,
  ) => AsyncGenerator<StreamEvent | Message, APICallResult>

  // 阶段 3: 错误恢复
  recover: (
    lastMessage: AssistantMessage | undefined,
    state: State,
    deps: QueryDeps,
  ) => Promise<RecoveryResult>

  // 阶段 4: 工具执行
  executeTools: (
    toolUseBlocks: ToolUseBlock[],
    assistantMessages: AssistantMessage[],
    toolUseContext: ToolUseContext,
    canUseTool: CanUseToolFn,
    config: QueryConfig,
  ) => AsyncGenerator<Message, ToolExecutionResult>

  // 阶段 5: 附件注入
  injectAttachments: (
    messages: Message[],
    toolUseContext: ToolUseContext,
    querySource: QuerySource,
  ) => AsyncGenerator<AttachmentMessage, Message[]>

  // 阶段 6: 退出判断
  shouldContinue: (
    state: State,
    config: QueryConfig,
  ) => ContinueDecision
}
```

**收益**:
- 每个阶段可独立测试
- 类型接口明确
- 代码审查更简单

---

### 4.6 类型修复优先级

| 步骤 | 内容 | 影响面 | 工作量 | 风险 |
|------|------|--------|--------|------|
| **CRITICAL** | 创建 `transitions.ts` | 23 return + 7 transition | 小 | 无 |
| **HIGH** | 消除 `content.filter().as` 断言 | `yieldMissingToolResultBlocks`, `queryLoop` 中的 `content.filter` | 中 | 低 |
| **HIGH** | 修复 `yieldMessage` 类型 | 流式响应处理 | 中 | 中 |
| **MEDIUM** | 统一 `analytics` 品牌类型 | `logEvent` 调用处 | 大 | 低 |
| **MEDIUM** | 修复 `usage` 不安全访问 | CACHED_MICROCOMPACT 路径 | 小 | 低 |
| **LOW** | Feature Flag gate 模式 | 14 个 feature flag 分支 | 大 | 中 |
| **LOW** | 拆分 `queryLoop` | 整个文件 | 特大 | 高 |

---

## 五、实施顺序

### Sprint 1：基础设施 (3-5 天)

```
Day 1-2: 创建 transitions.ts + 搭建测试框架
  ├── 1. 创建 src/query/transitions.ts（Terminal + Continue 类型）
  ├── 2. 安装 vitest
  ├── 3. 创建 src/query/__tests__/helpers/ 目录
  ├── 4. 实现 mock-factory.ts、mock-deps.ts、mock-context.ts
  └── 5. 编写第一个冒烟测试（Q-001: 无 tool_use 完成）

Day 3-4: 核心流程测试
  ├── 6. Q-002~Q-006（工具使用、中断）
  ├── 7. T-001~T-004（状态转换）
  └── 8. E-001~E-005（错误处理）

Day 5: 类型收紧
  ├── 9. 修复 yieldMessage 类型
  ├── 10. 修复 content.filter 断言 → 类型守卫
  └── 11. 修复 usage 不安全访问
```

### Sprint 2：深度测试 + 类型修复 (3-5 天)

```
Day 6-7: 附件与消息测试
  ├── 12. A-001~A-005（附件注入测试）
  ├── 13. M-001~M-005（消息处理测试）
  └── 14. S-001~S-004（安全检查测试）

Day 8-9: 类型修复
  ├── 15. 统一 AnalyticsMetadata 品牌类型
  ├── 16. 修复 signal.reason 类型扩展
  └── 17. innerError 类型守卫

Day 10: Feature Flag 测试
  ├── 18. F-001~F-004（Feature Flag 行为）
  └── 19. 编写测试覆盖率报告
```

### Sprint 3：架构优化 (后续，按需)

```
  20. Feature Flag gate 模式重构
  21. queryLoop 拆分为阶段函数
  22. 将 ReactiveCompact/ContextCollapse 纳入 QueryDeps
  23. 提取 Continue 决策逻辑为独立模块
```

---

## 六、风险缓解

| 风险 | 缓解措施 |
|------|----------|
| 重构引入 bug | 先写测试，在测试保护下重构 |
| Feature Flag 配置复杂 | 测试矩阵覆盖常见 flag 组合 |
| Mock 不准确 | Mock 只 mock 边界接口，内部逻辑保持真实 |
| 测试运行时间长 | 核心流程测试保持毫秒级，避免真正网络调用 |
| 类型修复导致大面积改动 | 修复按模块分批进行，每批后运行全部测试 |

---

## 附录：Terminal / Continue 类型设计

### Terminal 完整定义

```typescript
/**
 * Reason codes for query() AsyncGenerator return value.
 *
 * Used by callers (QueryEngine, print.ts) to determine post-loop behavior:
 *   - 'completed' → save costs, register completion
 *   - 'aborted_*' → show interruption message
 *   - 'max_turns' → show limit-reached message
 *   - 'prompt_too_long' → suggest /compact
 *   - '*_error' → log and surface error
 */

export type TerminalReason =
  | 'completed'
  | 'aborted_streaming'
  | 'aborted_tools'
  | 'blocking_limit'
  | 'max_turns'
  | 'image_error'
  | 'prompt_too_long'
  | 'hook_stopped'
  | 'stop_hook_prevented'
  | 'model_error'

export type Terminal = {
  [R in TerminalReason]: R extends 'max_turns'
    ? { reason: R; turnCount: number }
    : R extends 'model_error'
      ? { reason: R; error?: unknown }
      : { reason: R }
}[TerminalReason]
```

### Continue 完整定义

```typescript
/**
 * Reason codes for State.transition.
 *
 * Stored on each iteration so tests can assert recovery paths
 * without inspecting message contents. Callers outside tests
 * don't read this field.
 */
export type ContinueReason =
  | 'next_turn'
  | 'collapse_drain_retry'
  | 'reactive_compact_retry'
  | 'max_output_tokens_escalate'
  | 'max_output_tokens_recovery'
  | 'stop_hook_blocking'
  | 'token_budget_continuation'

export type Continue = {
  [R in ContinueReason]: R extends 'collapse_drain_retry'
    ? { reason: R; committed: number }
    : R extends 'max_output_tokens_recovery'
      ? { reason: R; attempt: number }
      : { reason: R }
}[ContinueReason]
```

### 使用示例

```typescript
// 类型安全的 return 语句
return { reason: 'completed' }                    // ✓
return { reason: 'max_turns', turnCount: 10 }     // ✓
return { reason: 'max_turns' }                    // ✗ 编译错误：缺少 turnCount
return { reason: 'unknown_reason' }               // ✗ 编译错误：不在联合中

// 类型安全的 transition
state = { ...state, transition: { reason: 'next_turn' } }           // ✓
state = { ...state, transition: { reason: 'collapse_drain_retry' } } // ✗ 编译错误：缺少 committed
```
