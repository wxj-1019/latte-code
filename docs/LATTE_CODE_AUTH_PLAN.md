# Latte Code 认证机制改造方案

## 核心目标

绕过原版 Claude Code 的 OAuth 登录机制，改为使用自定义 API 端点（OpenAI-compatible）的直接认证方式，同时将项目品牌从 "Claude" 改为 "Latte"。

---

## 关键改动总览

| 方面 | 原版 Claude Code | Latte Code |
|------|------------------|------------|
| 首次启动默认界面 | OAuth 登录方式选择 (`idle`) | API 格式选择 (`provider_select`) |
| 环境变量名 | `ANTHROPIC_API_KEY` | `LATTE_API_KEY` |
| 自定义端点 | 无原生支持 | 完整三步配置流程 |
| 配置目录 | `~/.claude` | `~/.latte` |
| 安全存储 Key | `customModelApiKeys` | `latteApiKeys` |

---

## 详细实施步骤

### 1. 环境变量替换（全局搜索替换）

将所有 `ANTHROPIC_API_KEY` 替换为 `LATTE_API_KEY`：

```typescript
// 需要修改的文件列表
- src/utils/auth.ts
- src/utils/env.ts
- src/utils/customApiStorage.ts  // 新建或修改
- src/services/api/client.ts
- src/cli/handlers/auth.ts
```

**核心常量定义：**

```typescript
// src/utils/envConstants.ts（新建或修改）
export const LATTE_API_KEY_ENV = 'LATTE_API_KEY'
export const LATTE_BASE_URL_ENV = 'LATTE_BASE_URL'
export const LATTE_MODEL_ENV = 'LATTE_MODEL'
```

---

### 2. ConsoleOAuthFlow.tsx 状态机改造

**修改默认入口状态：**

```typescript
// 原版默认状态
const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>({
  state: 'idle'  // OAuth 登录选择
})

// Latte Code 默认状态
const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>({
  state: 'provider_select'  // API 格式选择
})
```

**新增状态类型：**

```typescript
type OAuthStatus =
  | { state: 'idle' }
  | { state: 'platform_setup' }
  | { state: 'provider_select' }        // ← 新增：选择 API 格式
  | { state: 'custom_config'; step: 'baseURL' | 'apiKey' | 'model'; config: Partial<CustomConfig> }
  | { state: 'ready_to_start' }
  | { state: 'waiting_for_login'; url: string }
  | { state: 'creating_api_key' }
  | { state: 'about_to_retry'; nextState: OAuthStatus }
  | { state: 'success'; token?: string }
  | { state: 'error'; message: string; toRetry?: OAuthStatus }
```

**provider_select 状态实现：**

```typescript
case 'provider_select':
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>选择 API 提供商格式</Text>
      <Text>请选择你要使用的 API 格式：</Text>
      <Box marginTop={1}>
        <Select
          options={[
            {
              label: 'Anthropic-compatible API',
              value: 'anthropic',
              description: '兼容 Claude API 格式（如 OpenRouter、OneAPI）'
            },
            {
              label: 'OpenAI Chat Completions',
              value: 'openai_chat',
              description: '标准 OpenAI /chat/completions 端点'
            },
            {
              label: 'OpenAI Responses API',
              value: 'openai_responses',
              description: 'OpenAI /responses 端点（实验性）'
            },
            {
              label: 'Google Gemini API',
              value: 'gemini',
              description: 'Google Gemini OpenAI-compatible 端点'
            }
          ]}
          onChange={(value) => {
            logEvent('latte_provider_selected', { provider: value })
            setOAuthStatus({
              state: 'custom_config',
              step: 'baseURL',
              config: { provider: value }
            })
          }}
        />
      </Box>
    </Box>
  )
```

**custom_config 三步收集实现：**

```typescript
case 'custom_config': {
  const { step, config } = oauthStatus
  
  const steps = {
    baseURL: {
      title: '配置 API 端点',
      prompt: '请输入 Base URL（例如: https://api.openai.com）:',
      placeholder: 'https://...',
      validate: (value: string) => {
        try {
          new URL(value)
          return true
        } catch {
          return '无效的 URL 格式'
        }
      }
    },
    apiKey: {
      title: '配置 API Key',
      prompt: '请输入你的 API Key:',
      placeholder: 'sk-...',
      mask: '*',
      validate: (value: string) => value.length > 0 || 'API Key 不能为空'
    },
    model: {
      title: '配置模型',
      prompt: '请输入模型 ID（例如: gpt-4）:',
      placeholder: 'gpt-4, claude-3-sonnet, 等',
      validate: (value: string) => value.length > 0 || '模型 ID 不能为空'
    }
  }
  
  const currentStep = steps[step]
  
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{currentStep.title}</Text>
      <Text>步骤 {['baseURL', 'apiKey', 'model'].indexOf(step) + 1}/3</Text>
      <Text>{currentStep.prompt}</Text>
      <Box>
        <Text>{'> '}</Text>
        <TextInput
          mask={currentStep.mask}
          placeholder={currentStep.placeholder}
          onSubmit={(value) => {
            const error = currentStep.validate(value)
            if (error) {
              setOAuthStatus({ state: 'error', message: error })
              return
            }
            
            const newConfig = { ...config, [step]: value }
            
            if (step === 'baseURL') {
              setOAuthStatus({ state: 'custom_config', step: 'apiKey', config: newConfig })
            } else if (step === 'apiKey') {
              setOAuthStatus({ state: 'custom_config', step: 'model', config: newConfig })
            } else {
              // 最后一步，保存配置
              saveLatteConfig(newConfig)
              setOAuthStatus({ state: 'success' })
            }
          }}
        />
      </Box>
      <Text dimColor>按 Enter 确认，按 Esc 返回上一步</Text>
    </Box>
  )
}
```

---

### 3. 新增 isAnthropicAuthEnabled() 门控

**目的：** 当用户设置了 `LATTE_API_KEY` 时，完全跳过 Anthropic OAuth 流程。

```typescript
// src/utils/auth.ts

export function isAnthropicAuthEnabled(): boolean {
  // 如果设置了 LATTE_API_KEY，禁用 Anthropic OAuth
  if (process.env[LATTE_API_KEY_ENV]) {
    return false
  }
  
  // 如果存在有效的自定义端点配置，也禁用
  if (getLatteConfig().hasValidConfig) {
    return false
  }
  
  return true
}

// 在需要检查 OAuth 的地方使用
export function shouldShowOAuthLogin(): boolean {
  return isAnthropicAuthEnabled()
}
```

---

### 4. 新增 ApproveApiKey 审批页

**文件：** `src/components/ApproveApiKey.tsx`

```typescript
import React from 'react'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { Select } from './CustomSelect/select.js'
import { logEvent } from '../services/analytics/index.js'

interface Props {
  apiKey: string
  provider: string
  onApprove: () => void
  onReject: () => void
}

export function ApproveApiKey({ apiKey, provider, onApprove, onReject }: Props): React.ReactNode {
  const maskedKey = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
  
  useKeybinding('confirm:yes', onApprove, { isActive: true })
  useKeybinding('global:cancel', onReject, { isActive: true })
  
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold>检测到 API Key</Text>
      <Text>Latte Code 检测到你的环境中设置了 API Key：</Text>
      <Box marginLeft={2} marginTop={1} marginBottom={1}>
        <Text>提供商: <Text bold>{provider}</Text></Text>
        <Text>Key: <Text bold>{maskedKey}</Text></Text>
      </Box>
      <Text>是否使用此 API Key 登录？</Text>
      <Box marginTop={1}>
        <Select
          options={[
            { label: '是，使用此 Key', value: 'approve' },
            { label: '否，进入配置向导', value: 'reject' }
          ]}
          onChange={(value) => {
            logEvent('latte_api_key_approval', { approved: value === 'approve' })
            if (value === 'approve') {
              onApprove()
            } else {
              onReject()
            }
          }}
        />
      </Box>
    </Box>
  )
}
```

**在主流程中集成：**

```typescript
// src/components/Onboarding.tsx

function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep>(() => {
    // 检查是否有 LATTE_API_KEY
    if (process.env[LATTE_API_KEY_ENV]) {
      return 'approve_api_key'
    }
    // 检查是否有持久化配置
    if (getLatteConfig().hasValidConfig) {
      return 'auto_login'
    }
    return 'provider_select'
  })
  
  switch (step) {
    case 'approve_api_key':
      return (
        <ApproveApiKey
          apiKey={process.env[LATTE_API_KEY_ENV]!}
          provider={detectProviderFromKey(process.env[LATTE_API_KEY_ENV]!)}
          onApprove={() => setStep('auto_login')}
          onReject={() => setStep('provider_select')}
        />
      )
    // ... 其他步骤
  }
}
```

---

### 5. 新增 latteConfig 安全存储

**文件：** `src/utils/latteConfig.ts`

```typescript
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getSecureStorage } from './secureStorage/index.js'

const LATTE_CONFIG_STORAGE_KEY = 'latteApiKeys'
const LATTE_CONFIG_VERSION = 1

export interface LatteConfig {
  version: number
  provider: 'anthropic' | 'openai_chat' | 'openai_responses' | 'gemini'
  baseURL: string
  model: string
  createdAt: number
  updatedAt: number
}

export interface LatteConfigWithKey extends LatteConfig {
  apiKey: string
}

// 非敏感信息存储在全局配置
export function saveLatteConfig(config: Omit<LatteConfigWithKey, 'version' | 'createdAt' | 'updatedAt'>): void {
  const now = Date.now()
  const configWithoutKey: LatteConfig = {
    version: LATTE_CONFIG_VERSION,
    provider: config.provider,
    baseURL: config.baseURL,
    model: config.model,
    createdAt: now,
    updatedAt: now
  }
  
  // 保存元数据到全局配置
  saveGlobalConfig(current => ({
    ...current,
    latteConfig: configWithoutKey
  }))
  
  // 保存 API Key 到安全存储
  const secureStorage = getSecureStorage()
  const existing = (secureStorage.read() ?? {}) as Record<string, unknown>
  secureStorage.update({
    ...existing,
    [LATTE_CONFIG_STORAGE_KEY]: {
      apiKey: config.apiKey,
      savedAt: now
    }
  })
}

// 读取完整配置（含 API Key）
export function getLatteConfig(): LatteConfigWithKey | null {
  const globalConfig = getGlobalConfig()
  const latteConfig = globalConfig.latteConfig as LatteConfig | undefined
  
  if (!latteConfig) {
    return null
  }
  
  const secureStorage = getSecureStorage()
  const secureData = (secureStorage.read() ?? {}) as Record<string, unknown>
  const keyData = secureData[LATTE_CONFIG_STORAGE_KEY] as { apiKey: string } | undefined
  
  if (!keyData?.apiKey) {
    return null
  }
  
  return {
    ...latteConfig,
    apiKey: keyData.apiKey
  }
}

// 应用配置到环境变量
export function applyLatteConfigToEnv(): void {
  const config = getLatteConfig()
  if (!config) return
  
  process.env[LATTE_API_KEY_ENV] = config.apiKey
  process.env[LATTE_BASE_URL_ENV] = config.baseURL
  process.env[LATTE_MODEL_ENV] = config.model
  
  // 设置兼容模式环境变量
  switch (config.provider) {
    case 'openai_chat':
      process.env.LATTE_COMPAT_MODE = 'chat_completions'
      break
    case 'openai_responses':
      process.env.LATTE_COMPAT_MODE = 'responses'
      break
    case 'gemini':
      process.env.LATTE_COMPAT_MODE = 'gemini'
      break
    default:
      process.env.LATTE_COMPAT_MODE = 'anthropic'
  }
}
```

---

### 6. 配置目录修改

**文件：** `src/utils/env.ts`

```typescript
// 原版
export function getGlobalClaudeFile(): string {
  return join(getClaudeConfigHomeDir(), 'claude.json')
}

export function getClaudeConfigHomeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

// Latte Code 版本
export function getGlobalLatteFile(): string {
  return join(getLatteConfigHomeDir(), 'latte.json')
}

export function getLatteConfigHomeDir(): string {
  return process.env.LATTE_CONFIG_DIR || join(homedir(), '.latte')
}

// 保持向后兼容的别名
export const getGlobalClaudeFile = getGlobalLatteFile
export const getClaudeConfigHomeDir = getLatteConfigHomeDir
```

---

### 7. 启动流程改造

**修改后的启动流程图：**

```
启动 latte
    │
    ├─ 检测到 LATTE_API_KEY 环境变量？
    │   ├─ 是 + 已审批 → 直接进入主界面
    │   ├─ 是 + 未审批 → 显示 ApproveApiKey 审批页 → 进入主界面
    │   └─ 否 → 检查持久化配置
    │       ├─ 有有效配置 → 自动登录 → 进入主界面
    │       └─ 无配置 → 进入 Onboarding
    │
    └─ Onboarding 流程：
        ├─ 1. theme（主题选择）
        ├─ 2. provider_select ← 【Latte Code 新增】
        │       ├─ Anthropic-compatible API
        │       ├─ OpenAI Chat Completions
        │       ├─ OpenAI Responses
        │       └─ Google Gemini API
        ├─ 3. custom_config（三步输入）
        │       ├─ step: baseURL
        │       ├─ step: apiKey
        │       └─ step: model
        └─ 4. success → 进入主界面
```

---

### 8. 可选：保留原版 OAuth 的隐藏入口

如果你希望保留原版 OAuth 功能作为备用方案，可以添加 CLI 命令：

```typescript
// src/cli/handlers/auth.ts

export function registerAuthCommands(program: Command): void {
  // Latte Code 自定义登录
  program
    .command('login')
    .description('使用自定义 API 端点登录')
    .option('--provider <provider>', 'API 提供商格式')
    .option('--base-url <url>', 'API Base URL')
    .option('--api-key <key>', 'API Key')
    .option('--model <model>', '模型 ID')
    .action(async (options) => {
      if (options.provider && options.baseUrl && options.apiKey && options.model) {
        // 直接配置
        saveLatteConfig({
          provider: options.provider,
          baseURL: options.baseUrl,
          apiKey: options.apiKey,
          model: options.model
        })
        console.log('登录成功！')
      } else {
        // 启动交互式配置
        startLatteLoginFlow()
      }
    })
  
  // 原版 OAuth 登录（隐藏/备用）
  program
    .command('auth:oauth')
    .description('使用原版 Anthropic OAuth 登录（备用）')
    .option('--claudeai', '使用 Claude.ai 订阅登录')
    .option('--console', '使用 Anthropic Console 登录')
    .action(async (options) => {
      // 调用原版 OAuth 流程
      startOriginalOAuthFlow(options)
    })
}
```

---

## 文件修改清单

### 必须修改的文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/components/ConsoleOAuthFlow.tsx` | 默认状态改为 `provider_select`，新增 `custom_config` 状态处理 |
| `src/components/Onboarding.tsx` | 添加 `approve_api_key` 步骤，修改入口逻辑 |
| `src/components/ApproveApiKey.tsx` | 新建文件，API Key 审批组件 |
| `src/utils/latteConfig.ts` | 新建文件，配置存储和读取 |
| `src/utils/env.ts` | 修改配置目录为 `~/.latte` |
| `src/utils/auth.ts` | 添加 `isAnthropicAuthEnabled()` 门控 |

### 需要全局替换的字符串

```bash
# 环境变量名
ANTHROPIC_API_KEY → LATTE_API_KEY
ANTHROPIC_BASE_URL → LATTE_BASE_URL
ANTHROPIC_MODEL → LATTE_MODEL
CLAUDE_CONFIG_DIR → LATTE_CONFIG_DIR

# 配置目录（代码中硬编码的路径）
~/.claude → ~/.latte
.claude.json → .latte.json

# 安全存储 Key（如果使用了）
customModelApiKeys → latteApiKeys
```

---

## 安全性考虑

1. **API Key 不落地明文文件**：始终使用系统密钥链存储
2. **审批确认**：首次检测到环境变量中的 Key 时需要用户明确批准
3. **Key 掩码显示**：在 UI 中只显示前 8 位和后 4 位
4. **配置隔离**：与原版 Claude Code 配置完全隔离（`~/.latte` vs `~/.claude`）

---

## 测试 checklist

- [ ] 首次启动显示 `provider_select` 而非 OAuth 登录
- [ ] 三步配置流程可以正常完成
- [ ] 配置保存后自动注入环境变量
- [ ] 重启后自动读取持久化配置登录
- [ ] 设置 `LATTE_API_KEY` 环境变量后显示审批页
- [ ] 审批拒绝后进入配置向导
- [ ] API Key 存储在系统密钥链而非明文文件
- [ ] 可以通过 CLI 命令 `latte auth:oauth` 触发原版 OAuth（如保留）

---

## 总结

Latte Code 通过以下方式实现无 OAuth 启动：

1. **替换默认入口**：从 OAuth 选择改为 API 格式选择
2. **三步配置收集**：Base URL → API Key → Model
3. **安全存储**：API Key 存入系统密钥链，配置存入 `~/.latte/latte.json`
4. **自动注入**：启动时从安全存储读取配置并注入环境变量
5. **门控机制**：检测到自定义配置时完全跳过 Anthropic OAuth

原版 OAuth 机制全部保留但默认不可见，可通过 CLI 命令或特定参数触发。
