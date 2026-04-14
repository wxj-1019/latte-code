# AGENTS.md

本文件为 AI 编程助手提供关于 **latte** 项目的必要背景与操作指引。

## 项目概述

**latte** 是 Anthropic Claude Code CLI 的一个可构建分支（fork），版本号为 **2.1.88**。与上游相比，本项目的核心差异包括：

1. **移除遥测**：去除了所有外部分析、崩溃报告和会话指纹采集。
2. **移除安全提示硬编码守卫**：没有服务器推送的安全覆盖层或硬编码拒绝模式。
3. **解锁实验性功能**：通过编译时特性开关解锁了 54 个上游默认禁用的实验性功能。
4. **中文界面与多模型支持**：内置中文交互支持，并可通过 OpenAI 兼容适配器接入 DeepSeek、Kimi、GLM、Qwen、Ollama 等第三方模型。

- **仓库**：https://github.com/wxj-1019/latte-code
- **包管理器**：Bun >= 1.3.11（必需）
- **运行时**：Bun
- **语言**：TypeScript（ESNext + JSX）

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) >= 1.3.11 |
| 语言 | TypeScript（`strict: false`，`moduleResolution: bundler`） |
| 终端 UI | React 19 + [Ink](https://github.com/vadimdemedes/ink) |
| CLI 解析 | Commander.js |
| Schema 验证 | Zod v4 |
| HTTP 客户端 | 内置 Bun `fetch` / axios |
| 状态管理 | 自定义类 Zustand Store（`src/state/`） |
| LLM SDK | `@anthropic-ai/sdk` 及其 Bedrock/Vertex/Foundry 变体 |
| MCP 协议 | `@modelcontextprotocol/sdk` |
| 可观测性 | OpenTelemetry（mostly stubs） |

## 项目结构

```
latte/
├── scripts/
│   └── build.ts              # 构建脚本（含 Feature Flag 注入与版本号管理）
├── src/
│   ├── entrypoints/          # CLI 入口点
│   │   ├── cli.tsx           # 最轻量级入口：处理 --version 等快速路径
│   │   ├── init.ts           # 子系统初始化（配置、OAuth、LSP、代理等）
│   │   └── mcp.ts            # MCP Server 入口
│   ├── main.tsx              # Commander.js CLI 主入口
│   ├── screens/
│   │   └── REPL.tsx          # 主交互界面（Ink/React）
│   ├── QueryEngine.ts        # 核心查询引擎（协调消息流、工具调用、模型调用）
│   ├── query.ts              # LLM 查询循环（流式处理、工具解析、权限检查）
│   ├── commands.ts           # 斜杠命令注册表
│   ├── tools.ts              # Tool 注册表
│   ├── commands/             # 50+ 个斜杠命令实现（/help, /model, /login 等）
│   ├── tools/                # 30+ 个 Tool 实现（Bash, Read, Edit, Agent, MCP 等）
│   ├── components/           # Ink/React 终端 UI 组件
│   ├── hooks/                # React Hooks
│   ├── services/             # 外部服务集成
│   │   ├── api/              # API 客户端（claude.ts, client.ts, openai 适配器等）
│   │   ├── mcp/              # MCP 客户端实现
│   │   ├── oauth/            # OAuth 2.0 PKCE 流程
│   │   ├── lsp/              # Language Server Protocol
│   │   ├── policyLimits/     # 组织策略限制
│   │   └── analytics/        # 分析事件收集（mostly stubs）
│   ├── state/                # 全局状态管理（AppStateStore）
│   ├── skills/               # Skill 系统（内置 + 动态加载）
│   ├── plugins/              # 插件系统
│   ├── bridge/               # IDE 远程控制桥（Bridge Mode）
│   ├── voice/                # 语音输入系统
│   ├── tasks/                # 后台任务管理
│   ├── ink/                  # Ink 终端渲染引擎的内置 fork
│   ├── utils/                # 工具函数库
│   │   ├── model/            # 模型配置与 Provider 路由
│   │   ├── permissions/      # 权限系统
│   │   └── ...
│   ├── assistant/            # KAIROS 助手模式（实验性）
│   ├── bootstrap/            # 启动状态初始化
│   ├── cli/                  # CLI 子命令处理器（auth, mcp, plugins, bg 等）
│   ├── context/              # React Context providers
│   ├── memdir/               # 内存文件系统（CLAUDE.md 读写）
│   ├── remote/               # 远程会话相关
│   ├── schemas/              # JSON Schema 定义
│   ├── server/               # HTTP Server / Direct Connect
│   ├── types/                # TypeScript 类型定义（含大量生成类型）
│   ├── vendor/               # 第三方工具 vendoring（如 ripgrep 二进制）
│   └── vim/                  # Vim 模式相关
├── package.json
├── tsconfig.json
├── install.sh                # macOS/Linux 一键安装脚本
├── upload-release.ps1        # Windows 二进制上传 GitHub Release 脚本
├── README.md                 # 中文用户文档
├── CLAUDE.md                 # 给 Claude Code 的简明指引
└── docs/
    ├── ARCHITECTURE.md       # 中文架构文档
    ├── custom-model-guide.md # 自定义模型接入改造指南
    ├── LATTE_CODE_AUTH_PLAN.md
    └── plan.md
```

## 构建与运行命令

所有构建通过 `scripts/build.ts` 完成：

```bash
# 安装依赖
bun install

# 标准生产构建 → ./latte
bun run build

# 开发构建（带 dev 版本戳） → ./latte-dev
bun run build:dev

# 完整实验功能构建（54 个 feature flags） → ./latte-dev
bun run build:dev:full

# 编译为独立二进制到 dist 目录 → ./dist/latte
bun run compile

# 不编译直接运行源码（启动较慢，适合开发调试）
bun run dev

# 全局安装到系统 PATH
bun run install:global

# 卸载全局安装
bun run uninstall:global
```

### 构建系统细节

- 使用 `bun build --compile` 将源码与 `node_modules` 打包成单个可执行文件。
- **Feature Flag** 通过 `bun:bundle` 的 `feature()` 函数实现**编译时死代码消除（DCE）**。未启用的 feature 会在构建时被整体移除。
- 默认启用的 feature：`VOICE_MODE`。
- 完整实验性功能列表（`--feature-set=dev-full`）包含：`BRIDGE_MODE`, `ULTRAPLAN`, `ULTRATHINK`, `AGENT_TRIGGERS`, `BASH_CLASSIFIER`, `KAIROS`, `DAEMON`, `BG_SESSIONS`, `COORDINATOR_MODE`, `TEMPLATES`, `BYOC_ENVIRONMENT_RUNNER`, `SELF_HOSTED_RUNNER`, `DIRECT_CONNECT`, `SSH_REMOTE`, `LODESTONE`, `DUMP_SYSTEM_PROMPT`, `CHICAGO_MCP`, `TRANSCRIPT_CLASSIFIER`, `ABLATION_BASELINE`, `UPLOAD_USER_SETTINGS` 等。
- 构建时注入的宏定义：`MACRO.VERSION`, `MACRO.BUILD_TIME`, `MACRO.PACKAGE_URL`, `MACRO.FEEDBACK_CHANNEL` 等。

## 启动流程

```
cli.tsx (entry)
    │
    ├── Fast paths (--version, --dump-system-prompt, --claude-in-chrome-mcp,
    │   remote-control, daemon, ps/logs/attach/kill, environment-runner,
    │   self-hosted-runner, worktree+tmux 等)
    │
    └── Normal flow
        │
        ▼
    main.tsx (Commander.js 设置、GrowthBook 初始化、认证检查)
        │
        ▼
    init.ts (enableConfigs, OAuth, mTLS, CA certs, LSP, Scratchpad)
        │
        ▼
    replLauncher.tsx (Ink TUI 引导)
        │
        ▼
    REPL.tsx (主交互界面)
```

## 查询流水线（核心数据流）

系统的心脏 —— 用户输入如何变成 AI 响应：

```
User Input
    │
    ▼
QueryEngine.submitMessage()
    │
    ├── 1. Build System Prompt
    │   ├── fetchSystemPromptParts()
    │   ├── 加载 Memory / CLAUDE.md
    │   └── 注入 Skill / Plugin 上下文
    │
    ├── 2. processUserInput()
    │   ├── 解析斜杠命令（/model 等）
    │   ├── 处理文件附件
    │   └── 构建 UserMessage
    │
    ├── 3. query() 循环（src/query.ts）
    │   ├── 调用 Claude API（流式）
    │   ├── 解析 tool_use 块
    │   ├── 权限检查 canUseTool
    │   ├── 执行 Tool
    │   ├── 将结果追加到消息
    │   └── 循环直到 stop_reason
    │
    ├── 4. Auto Compact（上下文压缩）
    │
    └── 5. yield SDKMessage 给调用方
```

## 支持的模型提供商

| 提供商 | 环境变量 / 说明 | 认证方式 |
|--------|----------------|----------|
| Anthropic（默认） | - | `ANTHROPIC_API_KEY` / `LATTE_API_KEY` 或 OAuth |
| OpenAI 兼容 | `CLAUDE_CODE_COMPATIBLE_API_PROVIDER=openai` | `LATTE_API_KEY` / `DOGE_API_KEY` + Base URL |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | AWS 凭证 |
| Google Vertex | `CLAUDE_CODE_USE_VERTEX=1` | `gcloud auth application-default login` |
| Anthropic Foundry | `CLAUDE_CODE_USE_FOUNDRY=1` | `ANTHROPIC_FOUNDRY_API_KEY` |

### 关键环境变量

```bash
# API Key（优先使用 LATTE_ 前缀，也兼容 ANTHROPIC_ 和 DOGE_ 前缀）
LATTE_API_KEY="sk-..."
LATTE_BASE_URL="https://api.deepseek.com"   # 不带路径后缀
LATTE_MODEL="deepseek-chat"

# Provider 选择
CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"  # 或 gemini

# 简易模式（仅暴露 Bash/Read/Edit）
CLAUDE_CODE_SIMPLE=1

# 调试
DEBUG=1                    # 或 DEBUG=claude-ai-sdk
CLAUDE_CODE_PROFILE=1      # 启动性能分析
```

## Tool 系统

所有 Tool 实现 `Tool` 接口（见 `src/Tool.ts`）。Tool 在 `src/tools.ts` 中通过 `getAllBaseTools()` 注册。

### 核心 Tool

| Tool | 用途 |
|------|------|
| BashTool | Shell 命令执行（支持超时、输出截断） |
| PowerShellTool | Windows PowerShell 执行 |
| FileReadTool | 文件读取（带缓存） |
| FileEditTool | 基于 SEARCH/REPLACE 的精确编辑 |
| FileWriteTool | 文件创建/覆盖 |
| GlobTool | 文件模式匹配 |
| GrepTool | 内容正则搜索 |
| WebFetchTool | 网页抓取 |
| WebSearchTool | Web 搜索 |
| AgentTool | 子 Agent 委派（多 Agent 协作） |
| SkillTool | Skill 系统调用 |
| MCPTool | MCP Server 工具调用 |
| LSPTool | Language Server Protocol |
| TodoWriteTool | 任务列表管理 |
| AskUserQuestionTool | 交互式用户提问 |
| Task*Tool | 后台任务 CRUD |
| BriefTool | 上下文摘要 |
| EnterPlanModeTool / ExitPlanModeTool | 进入/退出规划模式 |

### Tool 特性

- **Feature Flag 门控**：部分 Tool 仅在特定 feature 启用时注册。
- **权限过滤**：`filterToolsByDenyRules()` 根据用户权限规则裁剪可用 Tool。
- **MCP 合并**：`assembleToolPool()` 合并内置 Tool 与 MCP Tool。
- **延迟加载**：Tool 可通过 `ToolSearch` 标记为延迟加载。

## 命令系统

命令实现 `Command` 接口（见 `src/commands.ts`）。三种类型：

| 类型 | 说明 | 示例 |
|------|------|------|
| `local` | 纯函数，返回文本 | /cost, /clear, /compact |
| `local-jsx` | 渲染 Ink UI 组件 | /model, /theme, /help |
| `prompt` | 展开为 prompt 文本发给模型 | /commit, /review |

### 命令来源（优先级顺序）

1. 内置命令（`COMMANDS()`）
2. Bundled Skills（`bundledSkills`）
3. Skill 目录（`.claude/skills/`）
4. Plugin Skills（`pluginSkills`）
5. Workflow 命令（`workflowCommands`）
6. MCP Skills（`mcpSkillCommands`）
7. 动态 Skills（`dynamicSkills`）

## 测试策略

**本代码库不存在自动化测试套件。** 测试完全依赖手动方式：

1. 运行构建后的 CLI：`./latte` 或 `./latte-dev`
2. 通过环境变量测试特定功能（如 `CLAUDE_CODE_COMPATIBLE_API_PROVIDER=openai`）
3. 使用内置 `/doctor` 命令进行诊断检查

> 注意：`docs/custom-model-guide.md` 中描述了单元测试与集成测试的设想结构，但对应的测试文件并未实际存在于仓库中。

## 代码风格与开发约定

- **导入**：所有导入使用 `.js` 扩展名（TypeScript 开启 `allowImportingTsExtensions`）。
- **类型**：`strict: false`（`tsconfig.json`）。
- **格式化/Linting**：使用 Biome（非 ESLint）。代码中常见 `// biome-ignore` 注释。
- **顶层副作用**：必须标记为 `// eslint-disable-next-line custom-rules/no-top-level-side-effects`。
- **Feature 门控**：使用 `feature('FLAG_NAME')` 进行编译时条件代码。
- **循环依赖**：使用延迟 `require()` 打破循环依赖。
- **快速路径**：`cli.tsx` 大量使用动态导入，避免不必要的模块加载。
- **异步生成器**：查询流水线使用 `AsyncGenerator<SDKMessage>` 实现流式传输。

## 部署与发布

### NPM 平台分包发布（推荐）

项目已将 `latte` 发布到 npm Registry，采用与 `esbuild`、`prisma` 等行业标准一致的**平台分包**模式：

```bash
# 全局安装（自动匹配当前平台）
npm install -g @zenjiro-latte/latte-code
```

#### 包结构

- **`latte`** — 主包（~5KB），包含平台检测启动脚本 `bin/latte.js`
- **`latte-code-darwin-x64`** — macOS Intel 二进制
- **`latte-code-darwin-arm64`** — macOS Apple Silicon 二进制
- **`latte-code-linux-x64`** — Linux x64 二进制
- **`latte-code-linux-arm64`** — Linux arm64 二进制
- **`latte-code-win32-x64`** — Windows x64 二进制

主包通过 `optionalDependencies` 引用所有平台子包，npm 在安装时只会下载与当前 `process.platform` + `process.arch` 匹配的一个子包。

#### 发布脚本

```bash
# 本地手动发布（需提前准备好各平台二进制）
bun run publish:npm -- --binary-dir ./dist/binaries

# 仅做结构验证，不真正发布
bun run publish:npm -- --binary-dir ./dist/binaries --dry-run
```

#### 自动化 CI/CD

- **`.github/workflows/build-and-publish.yml`** — GitHub Actions 工作流
  - 使用 Matrix 策略在 5 个平台上并行编译二进制
  - 收集 artifact 后统一调用 `scripts/publish-npm.ts` 发布到 npm
  - 触发方式：`workflow_dispatch`（手动）或推送 `v*.*.*` 标签

### 其他安装方式

- **macOS/Linux 安装**：`install.sh` 脚本会克隆仓库到 `~/latte`，执行 `bun run build:dev:full`，并在 `~/.local/bin/latte` 创建符号链接。
- **Windows 发布**：`upload-release.ps1` 将构建好的 `cli.exe` 作为 `latte.exe` 上传到 GitHub Release。

## 安全与权限

### 权限模型

```typescript
ToolPermissionContext
├── mode: 'default' | 'plan' | 'bypassPermissions'
├── alwaysAllowRules: ToolPermissionRulesBySource
├── denyRules: ToolPermissionRulesBySource
└── additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
```

### 策略限制

企业用户可通过以下方式强制限制：
- `src/services/policyLimits/` — 本地策略执行
- 远程托管设置 — 服务器推送配置
- MDM（Mobile Device Management）— macOS 企业控制

### 安全默认值

- Tool 默认 `isConcurrencySafe: false`
- Tool 默认 `isReadOnly: false`（假设会写入）
- Tool 默认 `isDestructive: false`
- 权限检查默认 `{ behavior: 'allow' }`，但每个 Tool 应实现具体检查逻辑

## 常见开发任务

### 添加新 Tool

1. 在 `src/tools/ToolNameTool/` 创建目录。
2. 按 `Tool` 接口实现。
3. 从 `src/tools/ToolNameTool/ToolNameTool.ts` 导出。
4. 在 `src/tools.ts` 的 `getAllBaseTools()` 中注册。
5. 如需实验性控制，添加 Feature Flag 门控。

### 添加新命令

1. 在 `src/commands/command-name/` 创建目录。
2. 按 `Command` 接口实现。
3. 从 `src/commands/command-name/index.ts` 导出。
4. 在 `src/commands.ts` 中导入并注册到 `COMMANDS()`。

### 添加 Feature Flag

1. 在 `scripts/build.ts` 的 `fullExperimentalFeatures` 数组中添加（如果是实验性）。
2. 在 `defaultFeatures` 中添加（如果始终启用）。
3. 在代码中使用 `feature('FLAG_NAME')` 进行条件编译。

## 调试

```bash
# 详细日志
DEBUG=1 ./latte

# 特定模块调试
DEBUG=claude-ai-sdk ./latte

# 启动性能分析（内置）
CLAUDE_CODE_PROFILE=1 ./latte
```

## 外部依赖

关键外部包：

- `@anthropic-ai/sdk` — Anthropic API 客户端
- `@anthropic-ai/bedrock-sdk` — AWS Bedrock 集成
- `@anthropic-ai/vertex-sdk` — Google Vertex 集成
- `@anthropic-ai/claude-agent-sdk` — Agent SDK
- `@modelcontextprotocol/sdk` — MCP 协议
- `ink` — 终端 UI（使用内置 fork `src/ink/`）
- `react` / `react-reconciler` — UI 框架
- `commander` — CLI 参数解析
- `zod` — Schema 验证
- `chalk` — 终端颜色
- `execa` — 进程执行
- `diff` — 文本 diff（用于文件编辑）

## 资源

- **上游项目**：Claude Code by Anthropic（https://docs.anthropic.com/en/docs/claude-code）
- **Bun 文档**：https://bun.sh/docs
- **Ink 文档**：https://github.com/vadimdemedes/ink
- **MCP 规范**：https://modelcontextprotocol.io
