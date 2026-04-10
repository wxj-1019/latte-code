# 项目架构与逻辑文档

> **项目名称**: claude-code-source-snapshot  
> **版本**: 2.1.87  
> **技术栈**: TypeScript + Bun Runtime + React (Ink) + Anthropic SDK  
> **包管理器**: Bun >= 1.3.11  

---

## 一、项目概述

本项目是一个基于终端的 AI 编程助手 CLI 工具（Claude Code），使用 Anthropic Claude 模型提供代码生成、文件操作、Shell 执行、Web 搜索等能力。整个应用以 **Bun** 作为运行时和构建工具，采用 **React + Ink** 渲染终端 UI，通过 **Commander.js** 解析命令行参数，以 **Feature Flag** 系统控制功能的编译时裁剪。

---

## 二、顶层目录结构

```
latte-main/
├── scripts/
│   └── build.ts            # 构建脚本（含 Feature Flag 注入）
├── src/
│   ├── entrypoints/        # 入口点（CLI / MCP Server / Init）
│   ├── screens/            # 页面级组件（REPL.tsx 主界面）
│   ├── components/         # 终端 UI 组件（Ink/React）
│   ├── hooks/              # React Hooks
│   ├── context/            # React Context providers
│   ├── state/              # 全局状态管理（AppState Store）
│   ├── services/           # 外部服务集成（API / MCP / OAuth / LSP）
│   ├── commands/           # 斜杠命令实现（/help, /model 等）
│   ├── tools/              # Tool 实现（Bash, FileRead, Agent 等）
│   ├── constants/          # 常量、Prompt 模板、API 限制
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数库
│   ├── query/              # 查询配置（token budget, stop hooks）
│   ├── schemas/            # JSON Schema 定义
│   ├── memdir/             # 内存文件系统（CLAUDE.md 读写）
│   ├── skills/             # Skill 系统（bundled + 动态加载）
│   ├── plugins/            # 插件系统
│   ├── bridge/             # IDE Bridge（远程控制协议）
│   ├── buddy/              # 伴侣助手 UI
│   ├── cli/                # CLI handler（auth, mcp, plugins）
│   ├── ink/                # Ink 终端渲染引擎（内置 fork）
│   ├── keybindings/        # 快捷键系统
│   ├── bootstrap/          # 启动状态初始化
│   ├── upstreamproxy/      # 上游代理中继
│   ├── tasks/              # 后台任务管理
│   ├── server/             # HTTP Server 类型
│   ├── QueryEngine.ts      # 核心查询引擎
│   ├── commands.ts         # 命令注册表
│   ├── tools.ts            # Tool 注册表
│   ├── main.tsx            # Commander 主入口
│   └── query.ts            # LLM 查询循环
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── FEATURES.md
```

---

## 三、核心架构分层

### 3.1 启动流程

```
用户执行 cli 命令
       │
       ▼
┌──────────────────────────┐
│  src/entrypoints/cli.tsx  │  ← 最先执行，轻量级入口
│  - 解析 --version 快速路径  │
│  - Feature Flag 条件分发   │
│  - 分发到各子命令处理器     │
└──────────┬───────────────┘
           │ (非特殊路径)
           ▼
┌──────────────────────────┐
│  src/entrypoints/init.ts  │  ← 初始化子系统
│  - enableConfigs()        │
│  - OAuth / mTLS / Proxy   │
│  - CA 证书 / 上游代理      │
│  - LSP / Scratchpad       │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  src/main.tsx             │  ← Commander.js CLI 主入口
│  - 注册所有 CLI 选项       │
│  - GrowthBook 特性初始化   │
│  - 权限/认证检查           │
│  - 启动 REPL 或 Headless   │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  src/replLauncher.tsx     │  ← 启动 Ink TUI 渲染
│  - AppStateProvider       │
│  - REPL 组件挂载           │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  src/screens/REPL.tsx     │  ← 主交互界面
│  - 消息列表渲染            │
│  - 输入处理 / 快捷键       │
│  - Tool 权限确认 UI        │
│  - 成本追踪显示            │
└──────────────────────────┘
```

### 3.2 查询流水线（Query Pipeline）

这是整个系统最核心的数据流，控制用户输入如何经过 LLM API 获得响应：

```
用户输入 (Prompt)
       │
       ▼
┌──────────────────────────────────────┐
│  QueryEngine.submitMessage()         │
│  (src/QueryEngine.ts)                │
│                                      │
│  1. 构建 System Prompt               │
│     - fetchSystemPromptParts()       │
│     - 加载 Memory / CLAUDE.md        │
│     - 注入 Skill / Plugin 上下文      │
│                                      │
│  2. processUserInput()               │
│     - 解析斜杠命令 (/model 等)        │
│     - 处理文件附件                     │
│     - 构建 UserMessage               │
│                                      │
│  3. query() 查询循环                  │
│     (src/query.ts)                   │
│     ┌─────────────────────────┐      │
│     │  调用 Claude API         │      │
│     │  - 流式接收响应           │      │
│     │  - 解析 Tool Use 块      │      │
│     │  - 权限检查 canUseTool   │      │
│     │  - 执行 Tool            │      │
│     │  - 将结果追加到消息       │      │
│     │  - 循环直到 stop_reason  │      │
│     └─────────────────────────┘      │
│                                      │
│  4. Auto Compact（上下文压缩）         │
│     - 检测 token 预算                 │
│     - 触发 compaction 摘要            │
│                                      │
│  5. yield SDKMessage 给调用方         │
│     - assistant / user / progress    │
│     - stream_event / attachment      │
│     - result (最终结果)               │
└──────────────────────────────────────┘
```

### 3.3 状态管理

```
┌─────────────────────────────────────────────┐
│              AppState (全局状态)              │
│          (src/state/AppStateStore.ts)        │
│                                              │
│  - settings: SettingsJson                    │
│  - mainLoopModel: ModelSetting               │
│  - toolPermissionContext: ToolPermissionCtx  │
│  - verbose / isBriefOnly / expandedView      │
│  - speculationState (推测性执行)              │
│  - fileHistory (文件历史快照)                  │
│  - mcp: { tools, clients, resources }        │
│  - tasks / agents                            │
│  - fastMode / theme / cost                   │
│  - attribution (提交归属)                     │
└─────────────┬───────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │  AppStateProvider  │  ← React Context
    │  (src/state/       │
    │   AppState.tsx)    │
    └─────────┬─────────┘
              │
    ┌─────────┴──────────────┐
    │  createStore()         │  ← Zustand-like store
    │  (src/state/store.ts)  │  getState / setState / subscribe
    └────────────────────────┘
```

---

## 四、核心子系统详解

### 4.1 Tool 系统

每个 Tool 实现统一接口（[Tool.ts](file:///c:/Users/Administrator/Desktop/latte-main/src/Tool.ts)）：

| Tool | 职责 |
|------|------|
| **BashTool** | 执行 Shell 命令，支持超时、输出截断 |
| **FileReadTool** | 读取文件内容（带缓存） |
| **FileEditTool** | 基于 SEARCH/REPLACE 的精确编辑 |
| **FileWriteTool** | 写入/创建文件 |
| **GlobTool** | 文件模式匹配搜索 |
| **GrepTool** | 内容正则搜索 |
| **WebFetchTool** | 抓取网页内容 |
| **WebSearchTool** | Web 搜索 |
| **AgentTool** | 子 Agent 委派（多 Agent 协作） |
| **SkillTool** | 调用注册的 Skill |
| **MCPTool** | 调用 MCP Server 提供的工具 |
| **LSPTool** | Language Server Protocol 集成 |
| **TodoWriteTool** | 任务列表管理 |
| **AskUserQuestionTool** | 向用户提问 |
| **TaskCreateTool/Get/Update/List** | 后台任务 CRUD |
| **BriefTool** | 生成上下文摘要 |
| **EnterPlanModeTool** | 进入规划模式 |

Tool 注册通过 [tools.ts](file:///c:/Users/Administrator/Desktop/latte-main/src/tools.ts) 的 `getAllBaseTools()` 完成，支持：
- **Feature Flag 条件编译**：部分 Tool 仅在特定 feature 启用时注册
- **权限过滤**：`filterToolsByDenyRules()` 根据 deny 规则裁剪
- **MCP 合并**：`assembleToolPool()` 将内置 Tool 和 MCP Tool 合并去重
- **Simple 模式**：`CLAUDE_CODE_SIMPLE=1` 时仅暴露 Bash/Read/Edit

### 4.2 命令系统

每个命令实现 `Command` 接口（[commands.ts](file:///c:/Users/Administrator/Desktop/latte-main/src/commands.ts)），支持三种类型：

| 类型 | 说明 | 示例 |
|------|------|------|
| `local` | 纯函数执行，返回文本 | /cost, /clear, /compact |
| `local-jsx` | 渲染 Ink UI 组件 | /model, /theme, /help |
| `prompt` | 展开为 prompt 文本发给模型 | /commit, /review, skills |

命令来源分层：
1. **内置命令**（`COMMANDS()`）：编译时硬编码
2. **Bundled Skills**（`bundledSkills`）：内置技能
3. **Skill 目录**（`skillDirCommands`）：从 `.claude/skills/` 加载
4. **Plugin Skills**（`pluginSkills`）：插件注册的技能
5. **Workflow 命令**（`workflowCommands`）：工作流脚本
6. **MCP Skills**（`mcpSkillCommands`）：MCP Server 提供的技能
7. **动态 Skills**（`dynamicSkills`）：运行时发现的技能

### 4.3 服务层

```
src/services/
├── api/
│   ├── claude.ts        # Anthropic API 客户端封装
│   ├── client.ts        # HTTP 客户端
│   ├── bootstrap.ts     # 启动数据拉取
│   ├── errors.ts        # API 错误分类
│   ├── withRetry.ts     # 重试逻辑
│   └── usage.ts         # 用量统计
├── mcp/
│   ├── client.ts        # MCP 客户端实现
│   ├── config.ts        # MCP Server 配置管理
│   ├── auth.ts          # MCP 认证
│   └── types.ts         # MCP 类型定义
├── oauth/
│   ├── client.ts        # OAuth 2.0 PKCE 客户端
│   ├── crypto.ts        # 加密工具
│   └── index.ts         # OAuth 入口
├── lsp/
│   ├── LSPClient.ts     # Language Server Protocol 客户端
│   ├── manager.ts       # LSP Server 生命周期管理
│   └── config.ts        # LSP 配置
├── analytics/
│   └── sink.ts          # 分析事件收集
├── compact/
│   └── autoCompact.ts   # 自动上下文压缩
└── policyLimits/        # 组织策略限制
```

### 4.4 Bridge（远程控制）

Bridge 系统允许从移动端 / Web 客户端远程控制本地 CLI：

```
src/bridge/
├── bridgeMain.ts       # Bridge 主入口
├── bridgeApi.ts        # Bridge API 接口
├── bridgeConfig.ts     # Bridge 配置
├── bridgeMessaging.ts  # 消息协议
├── bridgeUI.ts         # Bridge UI 渲染
├── inboundMessages.ts  # 入站消息处理
├── replBridge.ts       # REPL 桥接
├── sessionRunner.ts    # 会话运行器
├── createSession.ts    # 会话创建
├── jwtUtils.ts         # JWT 工具
├── trustedDevice.ts    # 设备信任管理
└── types.ts            # 类型定义
```

### 4.5 Ink 终端渲染引擎

项目内置了 Ink 框架的 fork（[src/ink/](file:///c:/Users/Administrator/Desktop/latte-main/src/ink/)），提供：

- **React 组件模型**：Box, Text, Button, Link 等
- **终端布局引擎**：基于 Yoga (Flexbox) 布局
- **事件系统**：键盘输入、鼠标点击、焦点管理
- **终端 I/O**：ANSI/CSI/OSC 序列解析、SGR 样式渲染
- **虚拟滚动**：高性能大列表渲染
- **搜索高亮**：文本搜索与高亮

### 4.6 Skill 系统

```
src/skills/
├── bundled/           # 内置 Skills
│   ├── batch.ts       # 批量执行
│   ├── debug.ts       # 调试
│   ├── loop.ts        # 循环
│   ├── stuck.ts       # 卡住检测
│   └── verify.ts      # 验证
├── bundledSkills.ts   # 内置 Skill 注册
└── loadSkillsDir.ts   # 从目录动态加载 Skills
```

### 4.7 插件系统

```
src/plugins/
├── bundled/
│   └── index.ts       # 内置插件注册
└── builtinPlugins.ts  # 内置插件管理
```

插件可提供：
- 自定义斜杠命令
- 自定义 Skills
- Hook 回调（Pre/Post Tool Use）
- MCP Server 集成

---

## 五、数据流

### 5.1 一次完整的用户交互

```
1. 用户输入 → TextInput 组件捕获
2. REPL.tsx → useTextInput hook 处理
3. 输入经过：
   a. 历史记录追加 (history.ts)
   b. 斜杠命令解析 (processUserInput)
   c. 附件处理 (imagePaste, fileRead)
4. 构建 UserMessage → 追加到 AppState.messages
5. 触发 QueryEngine / ask() 查询循环
6. query() → claude.ts → Anthropic API (流式)
7. 响应流：
   a. text → 直接渲染
   b. tool_use → canUseTool 权限检查 → 执行 → tool_result
   c. 重复 6-7 直到 stop_reason=end_turn
8. 消息写入 Transcript (sessionStorage)
9. 成本追踪更新 (cost-tracker.ts)
10. UI 刷新显示结果
```

### 5.2 Tool 执行流程

```
模型返回 tool_use 块
       │
       ▼
canUseTool() 权限检查
       │
   ┌───┴───┐
   │       │
 allow   deny → 返回拒绝消息给模型
   │
   ▼
tool.execute(input, context)
   │
   ├── BashTool → Shell.ts → execa 执行
   ├── FileReadTool → fs.readFile + 缓存
   ├── FileEditTool → SEARCH/REPLACE 编辑
   ├── AgentTool → 创建子 AgentTask
   ├── MCPTool → MCP Client 调用
   └── ...
   │
   ▼
构建 tool_result → 追加到消息 → 继续查询循环
```

---

## 六、构建系统

### 6.1 构建脚本

[scripts/build.ts](file:///c:/Users/Administrator/Desktop/latte-main/scripts/build.ts) 负责：

1. **Feature Flag 注入**：通过 `--feature` 和 `--feature-set` 参数控制编译时特性裁剪
2. **版本号管理**：Dev 版本包含时间戳和 Git SHA
3. **输出模式**：
   - `bun run build` → `./cli`（标准构建）
   - `bun run build:dev` → `./cli-dev`（开发构建）
   - `bun run build:dev:full` → `./cli-dev`（全特性开发构建）
   - `bun run compile` → `./dist/cli`（编译为独立二进制）

### 6.2 Feature Flag 系统

通过 `bun:bundle` 的 `feature()` 函数实现编译时死代码消除（DCE）：

```typescript
// 编译时：如果 feature 不在 feature set 中，整个代码块被移除
if (feature('BRIDGE_MODE')) {
  // Bridge 相关代码
}
```

主要 Feature Flags 包括：
- `BRIDGE_MODE` — 远程控制
- `DAEMON` — 守护进程模式
- `VOICE_MODE` — 语音输入
- `ULTRAPLAN` — 超级规划
- `WORKFLOW_SCRIPTS` — 工作流脚本
- `MCP_SKILLS` — MCP Skill 集成
- `COORDINATOR_MODE` — 协调者模式（多 Agent）
- `KAIROS` — 助手模式

---

## 七、认证与安全

### 7.1 认证方式

| 方式 | 说明 |
|------|------|
| API Key | `ANTHROPIC_API_KEY` 环境变量 |
| OAuth | Claude.ai OAuth 2.0 PKCE 流程 |
| Bedrock | AWS IAM 认证 |
| Vertex | Google Cloud 认证 |

### 7.2 权限模型

```
ToolPermissionContext
├── mode: PermissionMode
│   ├── 'default'    — 每次操作需确认
│   ├── 'plan'       — 规划模式，只读
│   └── 'bypassPermissions' — 跳过所有确认
├── alwaysAllowRules  — 自动允许的规则
├── denyRules         — 拒绝规则
└── additionalWorkingDirectories — 额外工作目录
```

---

## 八、关键设计模式

### 8.1 分层 Feature Flag

- **编译时**：`feature('X')` → Bun 编译器移除未启用代码
- **运行时**：GrowthBook A/B 测试和特性开关
- **环境变量**：`CLAUDE_CODE_SIMPLE`, `ENABLE_LSP_TOOL` 等

### 8.2 懒加载与动态导入

入口文件大量使用 `dynamic import` 和 `require()` 实现按需加载，减少启动时间：
- 快速路径（如 `--version`）零模块加载
- 重模块（如 React/Ink）延迟到需要时才导入
- 条件导入避免循环依赖

### 8.3 异步生成器（AsyncGenerator）

查询流水线使用 `AsyncGenerator<SDKMessage>` 模式：
- `QueryEngine.submitMessage()` 逐步 yield 消息
- 调用方通过 `for await...of` 消费
- 支持流式传输和实时 UI 更新

### 8.4 插件化架构

- 命令、Tool、Skill、Hook 均可扩展
- MCP 协议支持外部工具服务器
- 插件通过 `loadAllPluginsCacheOnly()` 加载

---

## 九、外部依赖关系

```
Anthropic SDK (@anthropic-ai/sdk)     ← 核心 LLM API
├── Bedrock SDK                        ← AWS Bedrock 集成
├── Vertex SDK                         ← GCP Vertex 集成
├── Foundry SDK                        ← Anthropic Foundry
└── MCP SDK (@modelcontextprotocol)    ← MCP 协议实现

React 19 + React Reconciler            ← UI 框架
Ink (内置 fork)                        ← 终端渲染

Bun Runtime                            ← 运行时 + 构建工具
Commander.js                           ← CLI 参数解析
Zod                                    ← Schema 验证
OpenTelemetry                          ← 可观测性
```

---

## 十、总结

本项目的架构可概括为：

1. **入口层**：`cli.tsx` → `init.ts` → `main.tsx` → `REPL.tsx`，分层启动，快速路径优化
2. **查询引擎层**：`QueryEngine.ts` → `query.ts` → `claude.ts`，AsyncGenerator 驱动的 LLM 交互循环
3. **工具层**：`tools.ts` 注册 30+ 内置 Tool，通过 `Tool` 接口统一管理
4. **命令层**：`commands.ts` 注册 50+ 斜杠命令，支持 Skill/Plugin/MCP 动态扩展
5. **状态层**：`AppState` Store 集中管理全局状态，React Context 分发
6. **服务层**：API/MCP/OAuth/LSP 等外部服务封装
7. **UI 层**：Ink 终端渲染引擎，React 组件模型

整个系统通过 Feature Flag 实现灵活的功能裁剪，支持从简单的 CLI 工具到复杂的多 Agent 协作场景。
