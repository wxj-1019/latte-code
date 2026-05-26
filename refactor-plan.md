# Latte-Code 架构重构方案

## 任务一：提取 assembleToolPool 打破循环依赖

### 问题分析

```
循环路径：
tools.ts ──import──→ AgentTool/AgentTool.tsx
   ▲                      │
   │                      │
   └──────import { assembleToolPool }────┘
```

AgentTool 需要从 tools.ts 导入 `assembleToolPool`，而 tools.ts 又注册了 AgentTool，形成循环。

### 实施步骤

#### 1. 创建新模块 `src/utils/toolPool.ts`

```typescript
// src/utils/toolPool.ts
import type { Tool, Tools } from '../Tool.js'
import { toolMatchesName } from '../Tool.js'
import type { ToolPermissionRulesBySource } from './permissions/permissions.js'
import { filterToolsByDenyRules } from './permissions/permissions.js'

export interface ToolPoolConfig {
  baseTools: Tools
  mcpTools?: Tool[]
  skillTools?: Tool[]
  denyRules?: ToolPermissionRulesBySource
}

export function assembleToolPool(config: ToolPoolConfig): Tools {
  const { baseTools, mcpTools = [], skillTools = [], denyRules } = config
  
  const allTools = [...baseTools, ...mcpTools, ...skillTools]
  
  if (denyRules) {
    return filterToolsByDenyRules(allTools, denyRules)
  }
  
  return allTools
}

export function findToolInPool(tools: Tools, name: string): Tool | undefined {
  return tools.find(tool => toolMatchesName(tool, name))
}
```

#### 2. 修改 `src/tools.ts`

移除 `assembleToolPool` 函数定义，改为重导出：

```typescript
// 在文件顶部添加
export { assembleToolPool, type ToolPoolConfig } from './utils/toolPool.js'

// 删除原有的 assembleToolPool 函数实现
```

#### 3. 修改 `src/tools/AgentTool/AgentTool.tsx`

```typescript
// 修改导入路径
import { assembleToolPool } from '../../utils/toolPool.js'
// 替代：import { assembleToolPool } from '../../tools.js'
```

#### 4. 修改 `src/tools/AgentTool/resumeAgent.ts`

```typescript
// 修改导入路径
import { assembleToolPool } from '../../utils/toolPool.js'
// 替代：import { assembleToolPool } from '../../tools.js'
```

#### 5. 验证构建

```bash
bun run build:dev:full
```

---

## 任务二：按功能拆分 utils/ 目录

### 当前问题

- `src/utils/` 包含 301 个文件，31 个子目录
- 文件按类型混合存放，查找困难
- 职责边界模糊

### 目标结构

```
src/utils/
├── api/                    # API 相关工具
│   ├── api.ts
│   ├── dumpPrompts.ts
│   └── ...
├── cache/                  # 缓存相关
│   ├── fileStateCache.ts
│   └── ...
├── cli/                    # CLI 辅助
│   ├── print.ts
│   ├── exit.ts
│   └── ...
├── config/                 # 配置管理
│   ├── config.ts
│   ├── settings.ts
│   └── ...
├── debug/                  # 调试工具
│   ├── debug.ts
│   ├── log.ts
│   └── ...
├── files/                  # 文件操作
│   ├── fileHistory.ts
│   ├── glob.ts
│   └── ...
├── model/                  # 模型相关（已存在，保留）
│   ├── model.ts
│   ├── modelOptions.ts
│   └── ...
├── permissions/            # 权限相关（已存在，保留）
│   └── ...
├── prompt/                 # Prompt 处理
│   ├── systemPrompt.ts
│   ├── systemPromptType.ts
│   └── ...
├── shell/                  # Shell 执行
│   ├── Shell.ts
│   └── ...
├── text/                   # 文本处理
│   ├── ansi.ts
│   ├── diff.ts
│   └── ...
└── index.ts                # 统一导出（可选）
```

### 迁移映射表

| 原路径 | 新路径 | 功能分类 |
|--------|--------|----------|
| `api.ts` | `api/api.ts` | API 工具 |
| `attachments.ts` | `api/attachments.ts` | 附件处理 |
| `debug.ts` | `debug/debug.ts` | 调试 |
| `log.ts` | `debug/log.ts` | 日志 |
| `config.ts` | `config/config.ts` | 配置 |
| `fileHistory.ts` | `files/fileHistory.ts` | 文件历史 |
| `fileStateCache.ts` | `cache/fileStateCache.ts` | 缓存 |
| `systemPrompt.ts` | `prompt/systemPrompt.ts` | Prompt |
| `systemPromptType.ts` | `prompt/systemPromptType.ts` | Prompt 类型 |
| `Shell.ts` | `shell/Shell.ts` | Shell |
| `ansi.ts` | `text/ansi.ts` | 文本处理 |
| `cwd.ts` | `files/cwd.ts` | 工作目录 |
| `envUtils.ts` | `config/envUtils.ts` | 环境变量 |
| `errors.ts` | `debug/errors.ts` | 错误处理 |
| `messages.ts` | `api/messages.ts` | 消息处理 |
| `sessionStorage.ts` | `cache/sessionStorage.ts` | 会话存储 |
| `tokens.ts` | `model/tokens.ts` | Token 计算 |

### 实施策略

#### 阶段 1：创建目录结构

```bash
mkdir -p src/utils/{api,cache,cli,config,debug,files,prompt,shell,text}
```

#### 阶段 2：迁移文件（保持向后兼容）

每个文件迁移时，在原位置创建重导出：

```typescript
// src/utils/debug.ts（迁移后变为重导出）
export * from './debug/debug.js'
```

#### 阶段 3：更新核心模块导入

优先更新以下文件的导入路径：

1. `src/QueryEngine.ts`
2. `src/query.ts`
3. `src/tools.ts`
4. `src/commands.ts`

```typescript
// 修改前
import { logForDebugging } from './utils/debug.js'

// 修改后
import { logForDebugging } from './utils/debug/debug.js'
```

#### 阶段 4：清理旧文件

确认所有导入更新完成后，删除根目录下的旧文件（保留重导出文件一段时间）。

---

## 任务三：Bridge 层事件总线解耦

### 问题分析

```
强耦合链：
guiBridge.ts ──→ QueryEngine.ts ──→ query.ts
    │                                    │
    │                                    └──→ Tool.js → tools.ts
    └── 直接实例化和调用 QueryEngine 方法
```

guiBridge.ts 直接导入 QueryEngine，形成强耦合。

### 解耦方案：引入事件总线

#### 1. 创建事件总线模块 `src/events/EventBus.ts`

```typescript
// src/events/EventBus.ts

export type EventCallback<T = unknown> = (payload: T) => void | Promise<void>

export class EventBus {
  private listeners = new Map<string, Set<EventCallback>>()

  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as EventCallback)
    
    return () => this.off(event, callback)
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    this.listeners.get(event)?.delete(callback as EventCallback)
  }

  emit<T>(event: string, payload: T): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return
    
    for (const callback of callbacks) {
      try {
        const result = callback(payload)
        if (result instanceof Promise) {
          result.catch(err => console.error(`Event handler error for ${event}:`, err))
        }
      } catch (err) {
        console.error(`Event handler error for ${event}:`, err)
      }
    }
  }
}

// 全局事件总线实例
export const globalEventBus = new EventBus()

// 事件类型常量
export const Events = {
  QUERY_START: 'query:start',
  QUERY_MESSAGE: 'query:message',
  QUERY_TOOL_CALL: 'query:toolCall',
  QUERY_TOOL_RESULT: 'query:toolResult',
  QUERY_COMPLETE: 'query:complete',
  QUERY_ERROR: 'query:error',
  
  SESSION_CREATED: 'session:created',
  SESSION_UPDATED: 'session:updated',
  SESSION_ENDED: 'session:ended',
  
  PERMISSION_REQUESTED: 'permission:requested',
  PERMISSION_DECIDED: 'permission:decided',
} as const
```

#### 2. 修改 QueryEngine 发布事件

```typescript
// src/QueryEngine.ts
import { globalEventBus, Events } from './events/EventBus.js'

class QueryEngine {
  async submitMessage(input: UserInput): Promise<void> {
    globalEventBus.emit(Events.QUERY_START, {
      sessionId: this.sessionId,
      input,
    })
    
    try {
      const result = await this.processQuery(input)
      
      globalEventBus.emit(Events.QUERY_COMPLETE, {
        sessionId: this.sessionId,
        result,
      })
    } catch (error) {
      globalEventBus.emit(Events.QUERY_ERROR, {
        sessionId: this.sessionId,
        error,
      })
      throw error
    }
  }
  
  private async processQuery(input: UserInput) {
    // 处理消息时发布事件
    for await (const message of this.queryLoop(input)) {
      globalEventBus.emit(Events.QUERY_MESSAGE, {
        sessionId: this.sessionId,
        message,
      })
    }
  }
}
```

#### 3. 修改 guiBridge 订阅事件

```typescript
// src/bridge/guiBridge.ts
import { globalEventBus, Events } from '../events/EventBus.js'

export class GuiBridge {
  private unsubscribers: (() => void)[] = []
  
  constructor() {
    // 订阅事件，替代直接调用 QueryEngine
    this.unsubscribers.push(
      globalEventBus.on(Events.QUERY_MESSAGE, (payload) => {
        this.handleQueryMessage(payload)
      })
    )
    
    this.unsubscribers.push(
      globalEventBus.on(Events.QUERY_TOOL_CALL, (payload) => {
        this.handleToolCall(payload)
      })
    )
    
    this.unsubscribers.push(
      globalEventBus.on(Events.QUERY_COMPLETE, (payload) => {
        this.handleQueryComplete(payload)
      })
    )
  }
  
  dispose() {
    // 清理订阅
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.unsubscribers = []
  }
  
  private handleQueryMessage(payload: { sessionId: string; message: SDKMessage }) {
    // 处理查询消息，更新 GUI
    this.broadcast({
      type: 'message',
      data: payload.message,
    })
  }
  
  private handleToolCall(payload: { sessionId: string; toolCall: GuiToolCall }) {
    // 处理工具调用
    this.broadcast({
      type: 'toolCall',
      data: payload.toolCall,
    })
  }
  
  private handleQueryComplete(payload: { sessionId: string; result: unknown }) {
    // 处理查询完成
    this.broadcast({
      type: 'complete',
      data: payload.result,
    })
  }
}
```

#### 4. 修改 bridge 初始化代码

```typescript
// src/bridge/bridgeMain.ts
import { GuiBridge } from './guiBridge.js'

export function initBridge() {
  const guiBridge = new GuiBridge()
  
  // 不再需要传递 QueryEngine 实例
  // guiBridge.setQueryEngine(queryEngine)
  
  return guiBridge
}
```

---

## 实施优先级

| 优先级 | 任务 | 影响范围 | 风险 |
|--------|------|----------|------|
| P0 | 提取 assembleToolPool | 3 个文件 | 低 |
| P1 | Bridge 事件总线解耦 | 5+ 个文件 | 中 |
| P2 | utils/ 目录拆分 | 50+ 个文件 | 中 |

## 验证清单

每个任务完成后执行：

- [ ] `bun run build:dev:full` 构建通过
- [ ] `./latte-dev.exe --version` 正常输出
- [ ] `./latte-dev.exe -p "测试"` 基本功能正常
- [ ] 检查无新增循环依赖
