<p align="center">
  <img src="assets/screenshot.png" alt="latte" width="720" />
</p>

<h1 align="center">Latte</h1>

<p align="center">
  <strong>☕ 一杯香浓的 Claude Code 体验。</strong><br>
  中文界面 | 自动语言检测 | 多模型支持 | 皮卡丘图标<br>
  一个二进制文件，开箱即用。
</p>

<p align="center">
  <a href="#quick-install"><img src="https://img.shields.io/badge/install-one--liner-blue?style=flat-square" alt="Install" /></a>
  <a href="https://github.com/wxj-1019/latte-code/stargazers"><img src="https://img.shields.io/github/stars/wxj-1019/latte-code?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/wxj-1019/latte-code/issues"><img src="https://img.shields.io/github/issues/wxj-1019/latte-code?style=flat-square" alt="Issues" /></a>
  <a href="https://github.com/wxj-1019/latte-code/releases"><img src="https://img.shields.io/github/v/release/wxj-1019/latte-code?style=flat-square" alt="Release" /></a>
</p>

---

## ✨ 特性

- 🌏 **中文本地化** - 所有命令和界面支持中文显示
- 🎯 **自动语言检测** - 根据系统语言自动切换中英文
- 🤖 **多模型支持** - 支持 Anthropic、OpenAI、Kimi 等多个 AI 提供商
- ⚡ **实验性功能** - 解锁 54+ 个实验性功能标志
- 🐱 **可爱图标** - 皮卡丘 ASCII 艺术图标
- 📦 **单文件运行** - 一个可执行文件，无需安装

---

## 🚀 快速安装

### Windows（直接下载）

```powershell
irm https://github.com/wxj-1019/latte-code/releases/latest/download/latte.exe -OutFile latte.exe
.\latte.exe
```

### Linux / macOS（一键脚本）

```bash
curl -fsSL https://raw.githubusercontent.com/wxj-1019/latte-code/main/install.sh | bash
```

安装完成后运行 `latte` 并使用 `/login` 命令登录。

---

## 📋 目录

- [特性](#特性)
- [快速安装](#快速安装)
- [模型提供商](#模型提供商)
- [中文本地化](#中文本地化)
- [构建](#构建)
- [使用方法](#使用方法)
- [实验性功能](#实验性功能)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 🤖 模型提供商

Latte 支持多个 API 提供商，推荐通过交互式配置或环境变量切换。

### 交互式配置（推荐）

启动 Latte 后在认证界面选择 **"自定义 API 接入"**，按提示输入 Base URL、API Key 和模型名称即可，配置自动持久化。

### 环境变量配置

#### 核心环境变量

| 环境变量 | 说明 | 示例 |
|---|---|---|
| `LATTE_API_KEY` 或 `DOGE_API_KEY` | 第三方模型 API Key | `sk-your-api-key` |
| `LATTE_BASE_URL` 或 `ANTHROPIC_BASE_URL` | API Base URL（不带路径后缀） | `https://api.deepseek.com` |
| `LATTE_MODEL` 或 `ANTHROPIC_MODEL` | 模型名称 | `deepseek-chat` |
| `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` | 协议类型（仅 `openai` 可选） | `openai` |

> `LATTE_*` 和 `DOGE_*` / `ANTHROPIC_*` 两组变量均可使用，`LATTE_*` 优先级更高。

#### Anthropic（默认）

```bash
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
./cli-dev

# Bash
export ANTHROPIC_API_KEY="sk-ant-..."
./cli-dev
```

#### DeepSeek

```bash
# PowerShell
$env:LATTE_API_KEY = "sk-your-deepseek-api-key"
$env:LATTE_BASE_URL = "https://api.deepseek.com"
$env:LATTE_MODEL = "deepseek-chat"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
./cli-dev
```

| 模型 | 说明 |
|---|---|
| `deepseek-chat` | 通用对话模型（DeepSeek-V3），推荐日常使用 |
| `deepseek-reasoner` | 推理模型（DeepSeek-R1），支持思维链输出 |

#### Kimi（Moonshot）

```bash
# PowerShell
$env:LATTE_API_KEY = "sk-your-moonshot-api-key"
$env:LATTE_BASE_URL = "https://api.moonshot.cn/v1"
$env:LATTE_MODEL = "moonshot-v1-8k"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
./cli-dev
```

| 模型 | 说明 |
|---|---|
| `moonshot-v1-8k` | 8K 上下文 |
| `moonshot-v1-32k` | 32K 上下文 |
| `moonshot-v1-128k` | 128K 长上下文 |

#### 智谱 GLM

```bash
# PowerShell
$env:LATTE_API_KEY = "your-zhipu-api-key"
$env:LATTE_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
$env:LATTE_MODEL = "glm-4-flash"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
./cli-dev
```

#### 通义千问（Qwen）

```bash
# PowerShell
$env:LATTE_API_KEY = "sk-your-dashscope-api-key"
$env:LATTE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:LATTE_MODEL = "qwen-plus"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
./cli-dev
```

#### Ollama 本地模型

```bash
# PowerShell
$env:LATTE_API_KEY = "ollama"
$env:LATTE_BASE_URL = "http://localhost:11434/v1"
$env:LATTE_MODEL = "qwen2.5-coder:7b"
$env:CLAUDE_CODE_COMPATIBLE_API_PROVIDER = "openai"
./cli-dev
```

> Ollama 不验证 API Key，可填任意非空字符串。

#### OpenAI Codex

```bash
export CLAUDE_CODE_USE_OPENAI=1
latte
```

#### AWS Bedrock

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION="us-east-1"
latte
```

### 所有提供商汇总

| 提供商 | 协议 | 认证方式 | Tool Use |
|---|---|---|---|
| Anthropic | Anthropic 原生 | `ANTHROPIC_API_KEY` 或 OAuth | ✅ |
| DeepSeek | OpenAI 兼容 | `LATTE_API_KEY` | ✅ |
| Kimi | OpenAI 兼容 | `LATTE_API_KEY` | ✅ |
| 智谱 GLM | OpenAI 兼容 | `LATTE_API_KEY` | ✅ |
| 通义千问 | OpenAI 兼容 | `LATTE_API_KEY` | ✅ |
| Ollama | OpenAI 兼容 | 任意非空字符串 | ⚠️ 取决于模型 |
| OpenAI Codex | Codex 协议 | OAuth via OpenAI | ✅ |
| AWS Bedrock | Anthropic 原生 | AWS credentials | ✅ |
| Google Vertex AI | Anthropic 原生 | `gcloud auth` | ✅ |

### 注意事项

- `LATTE_BASE_URL` **不要**包含 `/chat/completions` 后缀，程序会自动拼接
- Thinking 模式会根据模型自动禁用，第三方模型无需手动配置
- 详细接入指南见 [`docs/custom-model-guide.md`](docs/custom-model-guide.md)

---

## 🌏 中文本地化

Latte 内置中文支持，自动检测系统语言：

- **命令中文描述** - 所有 60+ 个命令都有中文描述
- **Help 界面汉化** - 帮助菜单和快捷键提示
- **自动语言检测** - 根据 `LANG` 或 `LC_ALL` 环境变量自动切换
- **强制中文模式** - 设置 `SHOW_CHINESE=1` 强制显示中文

```bash
# 在中文环境下自动显示中文
export LANG=zh_CN.UTF-8
latte

# 或强制启用中文
export SHOW_CHINESE=1
latte
```

---

## 🛠️ 构建

### 要求

- [Bun](https://bun.sh) >= 1.3.11
- Git

```bash
# 克隆仓库
git clone https://github.com/wxj-1019/latte-code.git
cd latte-code

# 安装依赖
bun install

# 开发构建
bun run build:dev

# 生产构建
bun run build

# 运行
./cli-dev.exe
```

### 构建变体

| 命令 | 输出 | 特性 | 描述 |
|---|---|---|---|
| `bun run build` | `./cli.exe` | 基础功能 | 生产构建 |
| `bun run build:dev` | `./cli-dev.exe` | 基础功能 | 开发版本 |
| `bun run build:dev:full` | `./cli-dev.exe` | 所有 54 个实验性功能 | 完整解锁 |

---

## 💻 使用方法

```bash
# 交互式 REPL（默认）
./latte.exe

# 单次查询模式
./latte.exe -p "列出当前目录的文件"

# 指定模型
./latte.exe --model claude-opus-4-6

# 登录
./latte.exe /login

# 查看帮助
./latte.exe /help
```

### 常用命令

| 命令 | 中文描述 | 功能 |
|---|---|---|
| `/help` | 显示帮助 | 查看所有可用命令 |
| `/login` | 登录 | 使用 API Key 或 OAuth 登录 |
| `/config` | 配置面板 | 打开配置界面 |
| `/cost` | 显示费用 | 查看当前会话费用 |
| `/compact` | 压缩对话 | 节省 token |
| `/clear` | 清除历史 | 清空对话历史 |
| `/exit` | 退出 | 退出程序 |

---

## 🔬 实验性功能

使用 `bun run build:dev:full` 构建可解锁所有 54 个实验性功能：

| 功能 | 描述 |
|---|---|
| `VOICE_MODE` | 语音输入模式 |
| `ULTRAPLAN` | 超级计划模式 |
| `KAIROS` | 高级 AI 功能 |
| `BRIDGE_MODE` | 远程控制模式 |

---

## 🏗️ 技术栈

- **Runtime**: [Bun](https://bun.sh) - 快速 JavaScript 运行时
- **Language**: TypeScript
- **UI**: [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- **Build**: 单文件可执行编译

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。

---

<p align="center">
  Made with ☕ by <a href="https://github.com/wxj-1019">wxj-1019</a>
</p>
