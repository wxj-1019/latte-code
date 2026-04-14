# Latte

[![Version](https://img.shields.io/badge/version-2.1.90-blue)](https://github.com/wxj-1019/latte-code)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Latte 是 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的一个可构建分支（fork），去除了遥测和硬编码的安全提示守卫，并解锁了上游默认禁用的 54 个实验性功能。支持中文界面，以及通过 OpenAI 兼容适配器接入 DeepSeek、Kimi、GLM、Qwen、Ollama 等第三方模型。

<img src="assets/screenshot.png" alt="screenshot" width="720" />

---

## 目录

- [与上游的区别](#与上游的区别)
- [安装方式](#安装方式)
  - [系统要求](#系统要求)
  - [npm 安装（推荐）](#npm-安装推荐)
  - [GitHub Release 下载](#github-release-下载)
  - [一键脚本安装](#一键脚本安装)
  - [从源码构建](#从源码构建)
- [配置模型](#配置模型)
  - [交互式配置](#交互式配置)
  - [环境变量](#环境变量)
  - [配置文件](#配置文件)
- [使用](#使用)
  - [交互模式](#交互模式)
  - [单次查询](#单次查询)
  - [常用命令](#常用命令)
- [内置 Skills](#内置-skills)
- [实验性功能](#实验性功能)
- [故障排除](#故障排除)
- [构建](#构建)
- [更新日志](#更新日志)
- [技术栈](#技术栈)
- [开源协议](#开源协议)

---

## 与上游的区别

| 特性 | Claude Code (上游) | Latte |
|------|-------------------|-------|
| 遥测与分析 | 启用 | 完全移除 |
| 安全提示守卫 | 硬编码 + 服务器推送 | 移除 |
| 实验性功能 | 默认禁用 | 54 个功能可解锁 |
| 中文界面 | 有限 | 完整支持 |
| 第三方模型 | 不支持 | 通过 OpenAI 兼容适配器支持 |

---

## 安装方式

### 系统要求

- **macOS**: 10.15+ (x64 / arm64)
- **Linux**: 主流发行版 (x64 / arm64, glibc 2.31+)
- **Windows**: 10/11 (x64)
- 若从源码构建，需要 [Bun](https://bun.sh) >= 1.3.11

### 安装方式对比

| 方式 | 命令 | 特点 | 适用场景 |
|------|------|------|----------|
| npm | `npm install -g @zenjiro-latte/latte-code` | 自动匹配平台，一键安装 | 大多数用户 |
| GitHub Release | 手动下载 exe/binary | 不依赖 npm | Windows 用户 |
| 一键脚本 | `curl ... \| bash` | 自动克隆、构建、链接 PATH | macOS / Linux 开发者 |
| 源码构建 | `bun run build` | 可自定义 feature flags | 需要二次开发 |

### npm 安装（推荐）

```bash
npm install -g @zenjiro-latte/latte-code
```

安装后直接使用 `latte` 命令。npm 会自动下载与当前平台匹配的二进制文件。

### GitHub Release 下载

**Windows:**
```powershell
irm https://github.com/wxj-1019/latte-code/releases/latest/download/latte.exe -OutFile latte.exe
```

**macOS / Linux:**
在 [Releases](https://github.com/wxj-1019/latte-code/releases) 页面下载对应平台的二进制文件，赋予执行权限后移动到 PATH 目录即可。

### 一键脚本安装

```bash
curl -fsSL https://raw.githubusercontent.com/wxj-1019/latte-code/main/install.sh | bash
```

该脚本会：
1. 检查并安装 Bun（如未安装）
2. 克隆仓库到 `~/latte`
3. 执行 `bun run build:dev:full` 构建完整实验版
4. 创建符号链接到 `~/.local/bin/latte`

### 从源码构建

```bash
git clone https://github.com/wxj-1019/latte-code.git
cd latte-code
bun install
bun run build
```

构建完成后，当前目录会生成 `./latte`（Unix）或 `./latte.exe`（Windows）。

---

## 配置模型

### 交互式配置（推荐）

首次启动后，在认证界面选择「自定义 API 接入」，按提示输入：
- Provider 类型（Anthropic / OpenAI 兼容 / Gemini）
- Base URL（不带路径后缀，如 `https://api.deepseek.com`）
- API Key
- 模型名称

配置会自动保存到本地安全存储中。

### 环境变量

若不想使用交互式配置，可通过环境变量覆盖：

| 变量 | 说明 | 示例 |
|------|------|------|
| `LATTE_API_KEY` | API Key | `sk-your-key` |
| `LATTE_BASE_URL` | API 地址（不带路径后缀） | `https://api.deepseek.com` |
| `LATTE_MODEL` | 模型名称 | `deepseek-chat` |
| `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` | 协议类型 | `openai` / `gemini` |

兼容变量（优先级次于 `LATTE_*`）：
- `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`
- `DOGE_API_KEY`、`DOGE_BASE_URL`

#### 配置示例

**DeepSeek (PowerShell):**
```powershell
$env:LATTE_API_KEY = "sk-your-key"
$env:LATTE_BASE_URL = "https://api.deepseek.com"
$env:LATTE_MODEL = "deepseek-chat"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
```

**DeepSeek (Bash/Zsh):**
```bash
export LATTE_API_KEY="sk-your-key"
export LATTE_BASE_URL="https://api.deepseek.com"
export LATTE_MODEL="deepseek-chat"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"
```

**Kimi (PowerShell):**
```powershell
$env:LATTE_API_KEY = "sk-your-key"
$env:LATTE_BASE_URL = "https://api.moonshot.cn/v1"
$env:LATTE_MODEL = "moonshot-v1-8k"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
```

**GLM 智谱 (PowerShell):**
```powershell
$env:LATTE_API_KEY = "sk-your-key"
$env:LATTE_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
$env:LATTE_MODEL = "glm-4"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
```

**GLM 智谱 (Bash/Zsh):**
```bash
export LATTE_API_KEY="sk-your-key"
export LATTE_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
export LATTE_MODEL="glm-4"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"
```

**Qwen 通义千问 (PowerShell):**
```powershell
$env:LATTE_API_KEY = "sk-your-key"
$env:LATTE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:LATTE_MODEL = "qwen-plus"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
```

**Qwen 通义千问 (Bash/Zsh):**
```bash
export LATTE_API_KEY="sk-your-key"
export LATTE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export LATTE_MODEL="qwen-plus"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"
```

**Ollama 本地 (PowerShell):**
```powershell
$env:LATTE_API_KEY = "ollama"
$env:LATTE_BASE_URL = "http://localhost:11434/v1"
$env:LATTE_MODEL = "qwen2.5-coder:7b"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
```

**Ollama 本地 (Bash/Zsh):**
```bash
export LATTE_API_KEY="ollama"
export LATTE_BASE_URL="http://localhost:11434/v1"
export LATTE_MODEL="qwen2.5-coder:7b"
export CLAUDE_CODE_COMPATIBLE_API_PROVIDER="openai"
```

更多配置见 [`docs/custom-model-guide.md`](docs/custom-model-guide.md)。

### 配置文件

Latte 支持通过项目目录下的 `CLAUDE.md` 注入上下文，也支持全局配置文件（位于 `~/.claude/.claude.json`）。你可以在对话中通过 `/config` 命令打开配置面板。

---

## 使用

### 交互模式

```bash
latte
```

启动后进入 REPL，可直接输入自然语言指令，Latte 会自动调用工具（如 Bash、Read、Edit）完成操作。

### 单次查询

```bash
latte -p "列出当前目录的文件"
```

### 指定模型

```bash
latte --model claude-opus-4-6
```

### 登录

```bash
latte /login
```

### 常用命令

| 命令 | 作用 |
|------|------|
| `/help` | 显示所有可用命令 |
| `/login` | 登录 Anthropic 或自定义账号 |
| `/config` | 打开配置面板 |
| `/model` | 切换当前模型 |
| `/cost` | 查看当前会话 Token 消耗 |
| `/compact` | 压缩对话上下文 |
| `/clear` | 清除当前会话历史 |
| `/skills` | 列出所有可用 Skills |
| `/exit` | 退出程序 |

---

## 内置 Skills

Latte 集成了多个自动触发的技能，无需手动调用：

- **superpowers** — 完整的软件开发工作流框架。遇到代码相关任务时自动触发，涵盖需求分析、设计、编码、审查全流程。
- **design-md** — 66+ 品牌设计系统，支持设计审查与代码生成。遇到 UI/设计相关任务时自动触发。

查看所有技能：`/skills`

---

## 实验性功能

使用 `bun run build:dev:full` 构建时，会解锁全部 54 个实验性功能标志，包括：

- `VOICE_MODE` — 语音输入
- `ULTRAPLAN` — 超级计划模式
- `ULTRATHINK` — 深度思考增强
- `BRIDGE_MODE` — IDE 远程控制桥
- `KAIROS` — 高级 AI 功能
- `AGENT_TRIGGERS` — 智能代理触发器
- `BASH_CLASSIFIER` — Bash 命令智能分类

生产构建（`bun run build`）默认只启用 `VOICE_MODE`。

---

## 故障排除

### `latte: command not found`

**原因**: 命令不在系统 PATH 中。

**解决**:
- npm 安装：检查 npm 全局 bin 目录是否在 PATH 中
- 手动安装：将二进制所在目录添加到 PATH，或移动到已有的 PATH 目录（如 `~/.local/bin`）

### npm 安装时报 "Unsupported platform"

**原因**: 当前操作系统或 CPU 架构不在支持列表中。

**解决**: 参考 [从源码构建](#从源码构建) 自行编译。

### 模型无响应或返回错误

**原因**: API Key、Base URL 或模型名称配置错误。

**解决**:
1. 检查环境变量是否正确设置
2. 使用 `latte /config` 查看当前配置
3. 确认 Base URL 不带 `/chat/completions` 后缀

### Bun 构建时报版本错误

**原因**: Bun 版本低于 1.3.11。

**解决**: 执行 `bun upgrade` 升级 Bun。

---

## 构建

```bash
# 开发构建（带 dev 版本戳）
bun run build:dev

# 生产构建
bun run build

# 完整实验功能构建
bun run build:dev:full

# 编译为独立二进制
bun run compile
```

构建产物说明：
- `bun run build` → 生成 `./latte`
- `bun run build:dev` → 生成 `./latte-dev`
- `bun run compile` → 生成 `./dist/latte`

---

## 更新日志

### 2.1.90
- 发布 npm 平台分包，支持 `npm install -g @zenjiro-latte/latte-code`
- 新增 GitHub Actions 自动跨平台构建与发布工作流
- 修复 macOS x64 交叉编译及 npm 发布重试逻辑

### 2.1.88
- 将 npm 包名从 `latte` 迁移至 `latte-code`，规避命名冲突
- 新增 macOS 14 交叉编译支持
- 完善自定义模型接入文档

### 2.1.87
- 从 Claude Code 创建初始分支
- 移除遥测与硬编码安全提示守卫
- 支持中文界面与命令本地化
- 解锁 54 个实验性功能标志
- 支持 DeepSeek、Kimi、GLM、Qwen、Ollama 等第三方模型接入

完整变更记录见 [CHANGELOG.md](CHANGELOG.md)。

---

## 技术栈

- **Runtime**: [Bun](https://bun.sh) >= 1.3.11
- **Language**: TypeScript (ESNext + JSX)
- **Terminal UI**: [Ink](https://github.com/vadimdemedes/ink) (React for CLI)
- **CLI Parsing**: Commander.js
- **Schema Validation**: Zod v4
- **LLM SDK**: @anthropic-ai/sdk 及 Bedrock/Vertex/Foundry 变体
- **MCP Protocol**: @modelcontextprotocol/sdk

---

## 开源协议

MIT - 详见 [LICENSE](LICENSE)

如有问题或建议，欢迎提交 [Issue](https://github.com/wxj-1019/latte-code/issues)。
