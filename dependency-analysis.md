# Latte-Code 项目依赖关系分析报告

## 一、核心模块架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LATTE-CODE 架构依赖图                               │
└─────────────────────────────────────────────────────────────────────────────┘

【第一层：入口层】
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  cli.tsx    │───→│  main.tsx   │───→│  init.ts    │
│  (快速路径)  │    │ (Commander) │    │ (子系统初始化)│
└─────────────┘    └─────────────┘    └──────┬──────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │  replLauncher   │
                                    │   (Ink TUI)     │
                                    └────────┬────────┘
                                             │
                                             ▼
【第二层：核心引擎层】                          │
┌───────────────────────────────────────────┐│
│           QueryEngine.ts                   ││
│  ┌─────────────┐    ┌─────────────────┐   ││
│  │ submitMessage│───→│ processUserInput │  ││
│  └─────────────┘    └─────────────────┘   ││
│         │                                  ││
│         ▼                                  ││
│  ┌─────────────┐    ┌─────────────────┐   ││
│  │    query()   │←───│   query.ts      │   ││
│  │  (查询循环)   │    │ (LLM流式处理)    │   ││
│  └─────────────┘    └─────────────────┘   ││
└───────────────────────────────────────────┘│
         │                                   │
         │    ┌──────────────────────────────┘
         │    │
         ▼    ▼
【第三层：注册表层】
┌─────────────────┐         ┌─────────────────┐
│   commands.ts   │←───────→│    tools.ts     │
│  (命令注册中心)  │         │  (工具注册中心)  │
│                 │         │                 │
│ • 50+ 命令注册  │         │ • 30+ 工具注册  │
│ • 动态加载      │         │ • Feature Flag  │
│ • Skill 合并    │         │ • 延迟加载      │
└────────┬────────┘         └────────┬────────┘
         │                           │
         ▼                           ▼
【第四层：实现层】
┌─────────────────┐         ┌─────────────────┐
│  commands/      │         │   tools/        │
│  • doctor/      │         │  • BashTool/    │
│  • git/         │         │  • FileEditTool/│
│  • model/       │         │  • AgentTool/   │
│  • ...          │         │  • MCPTool/     │
└─────────────────┘         └─────────────────┘

【第五层：支撑层】
┌─────────────────────────────────────────────────────────┐
│  utils/  │  services/  │  hooks/  │  state/  │  bridge/ │
│  (301文件)│  (37文件)   │ (85文件) │ (6文件)  │ (28文件) │
└─────────────────────────────────────────────────────────┘
```

## 二、核心模块依赖矩阵

| 模块 | QueryEngine | query | tools | commands | bridge | 被引用次数 |
|------|:-----------:|:-----:|:-----:|:--------:|:------:|:---------:|
| **QueryEngine** | - | 导入 | 导入 | 导入 | - | 1 (guiBridge) |
| **query** | 被QueryEngine导入 | - | 使用Tool | - | - | 3 (forkedAgent, LocalMainSessionTask, guiBridge) |
| **tools** | 被QueryEngine导入 | 被query使用 | - | - | 被guiBridge导入 | 25+ |
| **commands** | 被QueryEngine导入 | - | AgentTool使用 | - | bridge-kick使用 | 21+ |
| **bridge/guiBridge** | 直接导入 | - | 直接导入 | - | - | 3 |

## 三、循环依赖分析

### 🔴 发现潜在循环依赖

```
【循环 1：AgentTool 循环】
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   tools.ts ──→ AgentTool/AgentTool.tsx ──→ tools.ts        │
│      │              │                          ▲            │
│      │              │                          │            │
│      │              └─→ import { assembleToolPool }         │
│      │                                         │            │
│      └─────────────────────────────────────────┘            │
│         (通过 tools.ts 注册表反向引用)                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘

【循环 2：QueryEngine ↔ query 循环】
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   QueryEngine.ts ──→ query.ts                              │
│        ▲                      │                             │
│        │                      │                             │
│        └──────────────────────┘                             │
│        (query.ts 中的工具执行回调到 QueryEngine)             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

【循环 3：commands ↔ tools 间接循环】
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   commands.ts ──→ 各命令实现 ──→ 使用 Tool 类型              │
│        ▲                                              │     │
│        │                                              │     │
│        └────────── AgentTool/runAgent.ts ─────────────┘     │
│                     (导入 commands.js 和 query.js)           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 🟡 延迟加载打破的循环

代码中已经使用延迟 `require()` 打破的循环：

| 位置 | 延迟加载的模块 | 打破的循环 |
|------|--------------|-----------|
| `tools.ts:63-71` | TeamCreateTool, TeamDeleteTool, SendMessageTool | tools.ts ↔ 各Tool实现 |
| `tools.ts:16-28` | REPLTool, SleepTool 等 | 条件编译避免循环 |
| `QueryEngine.ts:87-89` | MessageSelector.tsx | QueryEngine ↔ UI组件 |
| `query.ts:14-20` | reactiveCompact, contextCollapse | query ↔ 压缩模块 |

## 四、架构热点分析

### 🔥 高中心性模块（被大量引用）

| 排名 | 模块 | 被引用次数 | 角色 |
|------|------|:---------:|------|
| 1 | `Tool.js` | 25+ | 工具类型定义中心 |
| 2 | `commands.js` | 21+ | 命令类型定义中心 |
| 3 | `query.ts` | 3+ | 查询执行引擎 |
| 4 | `QueryEngine.ts` | 1 | 消息处理协调器 |
| 5 | `utils/debug.js` | 15+ | 调试日志工具 |

### 📊 模块依赖扇出分析

```
QueryEngine.ts (扇出: 40+)
├── commands.js
├── query.js
├── Tool.js
├── state/AppState.js
├── utils/processUserInput/processUserInput.js
├── utils/queryContext.js
├── utils/sessionStorage.js
├── utils/messages.js
├── cost-tracker.js
├── memdir/memdir.js
└── ... (30+ 其他模块)

query.ts (扇出: 35+)
├── Tool.js
├── utils/messages.js
├── utils/attachments.js
├── utils/model/model.js
├── services/compact/compact.js
├── services/tools/toolOrchestration.js
├── utils/api.js
└── ... (25+ 其他模块)

tools.ts (扇出: 30+)
├── 各 Tool 实现目录
├── Tool.js
├── utils/toolSearch.js
├── utils/tasks.js
└── constants/tools.js
```

## 五、bridge 模块特殊分析

```
bridge/ 目录依赖关系:
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  guiBridge.ts ──→ QueryEngine.ts                           │
│       │                                                     │
│       ├──→ tools.ts (getAllBaseTools)                      │
│       │                                                     │
│       ├──→ server/guiServer.ts                             │
│       │                                                     │
│       └──→ gui/src/shared/protocol.ts                      │
│                                                             │
│  replBridge.ts ──→ cli/transports/HybridTransport.js       │
│       │                                                     │
│       └──→ utils/concurrentSessions.js                     │
│                                                             │
│  bridgeMain.ts ──→ 协调各 bridge 实现                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘

【注意】guiBridge.ts 直接导入 QueryEngine，形成强耦合:
  guiBridge.ts ──→ QueryEngine.ts ──→ query.ts ──→ Tool.js
                                      │
                                      └──→ commands.js
```

## 六、建议与改进

### 1. 循环依赖处理建议

| 优先级 | 问题 | 建议方案 |
|--------|------|----------|
| 高 | AgentTool ↔ tools.ts | 将 `assembleToolPool` 提取到独立工具模块 |
| 中 | QueryEngine ↔ query | 考虑将 query 函数内联或重构为类方法 |
| 低 | commands ↔ tools 间接循环 | 已通过延迟加载缓解，保持现状 |

### 2. 架构解耦建议

```
【提议：引入依赖注入容器】

当前:                    改进后:
┌─────────┐             ┌─────────────┐
│QueryEngine│             │  DI Container │
│ 直接导入  │  ──────→   │  (注册/解析)  │
│各模块    │             └──────┬──────┘
└─────────┘                    │
                               ▼
                    ┌─────────────────────┐
                    │  QueryEngine 通过 DI  │
                    │  获取依赖，而非直接导入 │
                    └─────────────────────┘
```

### 3. 模块边界优化

| 模块 | 当前问题 | 优化方向 |
|------|---------|----------|
| `utils/` (301文件) | 过于庞大 | 按功能拆分为子包 |
| `services/` | 与 utils 边界模糊 | 明确服务层职责 |
| `bridge/` | 直接依赖 QueryEngine | 通过事件总线解耦 |

## 七、CodeGraphy 可视化建议

如果使用 CodeGraphy 分析此项目，建议关注：

1. **File Nodes**: 关注 `QueryEngine.ts`, `query.ts`, `tools.ts`, `commands.ts`
2. **Edge Types**: 
   - `import` 依赖（静态导入）
   - `dynamic-import` 依赖（延迟 require）
   - `type-import` 依赖（仅类型引用）
3. **Graph Sections**:
   - 核心引擎区：QueryEngine + query
   - 注册中心区：commands + tools
   - 工具实现区：tools/*/
   - 命令实现区：commands/*/
   - 桥接层区：bridge/*/
