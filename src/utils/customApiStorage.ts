import {
  getGlobalConfig,
  saveGlobalConfig,
  type CustomModelConfig,
  type CustomModelProvider,
  type OpenAICompatibleMode,
} from './config.js'
import { logForDebugging } from './debug.js'
import type { ModelOption } from './model/modelOptions.js'
import { getSecureStorage } from './secureStorage/index.js'

const CUSTOM_MODEL_API_KEYS_STORAGE_KEY = 'customModelApiKeys'
const COMPATIBLE_PROVIDER_ENV = 'CLAUDE_CODE_COMPATIBLE_API_PROVIDER'
const OPENAI_COMPAT_MODE_ENV = 'CLAUDE_CODE_OPENAI_COMPAT_MODE'
const CUSTOM_MODEL_API_KEY_ENV = 'DOGE_API_KEY'
const LATTE_API_KEY_ENV = 'LATTE_API_KEY'
const LATTE_BASE_URL_ENV = 'LATTE_BASE_URL'
const LATTE_MODEL_ENV = 'LATTE_MODEL'

type CustomModelApiKeyMap = Record<string, string>
type SecureStorageUpdateData = Parameters<
  ReturnType<typeof getSecureStorage>['update']
>[0]

export type ResolvedCustomModelConfig = CustomModelConfig & {
  apiKey?: string
  source: 'env' | 'saved'
  isActive: boolean
}

export type SaveCustomModelInput = {
  name: string
  provider?: CustomModelProvider
  baseURL: string
  model: string
  apiMode?: OpenAICompatibleMode
  apiKey?: string
  activate?: boolean
  maxTokens?: number
}

export type SaveCustomModelResult = {
  success: boolean
  error?: string
  warning?: string
  model?: CustomModelConfig
}

function getConfiguredCompatibleProvider(): CustomModelProvider | null {
  const explicitProvider = normalizeCustomModelProvider(
    process.env[COMPATIBLE_PROVIDER_ENV],
  )
  if (explicitProvider) {
    return explicitProvider
  }

  if (
    process.env[LATTE_BASE_URL_ENV]?.trim() ||
    process.env[LATTE_MODEL_ENV]?.trim() ||
    process.env[LATTE_API_KEY_ENV]?.trim()
  ) {
    return 'openai'
  }

  return null
}

function getPreferredCustomModelApiKey(): string | undefined {
  return (
    process.env[LATTE_API_KEY_ENV]?.trim() ||
    process.env[CUSTOM_MODEL_API_KEY_ENV]?.trim() ||
    undefined
  )
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeCustomModelProvider(
  value: string | undefined,
): CustomModelProvider | null {
  if (!value) return null
  return value.trim().toLowerCase() === 'openai' ? 'openai' : null
}

export function normalizeOpenAICompatibleMode(
  value: string | undefined,
): OpenAICompatibleMode {
  return value?.trim().toLowerCase() === 'responses'
    ? 'responses'
    : 'chat_completions'
}

export function normalizeCustomModelBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function getCustomModelApiKeys(): CustomModelApiKeyMap {
  const secureStorage = getSecureStorage()
  const rawStorage = (secureStorage.read() ?? {}) as Record<string, unknown>
  const rawMap = rawStorage[CUSTOM_MODEL_API_KEYS_STORAGE_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(rawMap).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function saveCustomModelApiKeys(
  nextApiKeys: CustomModelApiKeyMap,
): { success: boolean; warning?: string } {
  const secureStorage = getSecureStorage()
  const existingStorage = (secureStorage.read() ?? {}) as Record<string, unknown>
  const sanitizedApiKeys = Object.fromEntries(
    Object.entries(nextApiKeys).filter(([, value]) => value.trim().length > 0),
  )

  const nextStorage = {
    ...existingStorage,
    [CUSTOM_MODEL_API_KEYS_STORAGE_KEY]:
      Object.keys(sanitizedApiKeys).length > 0 ? sanitizedApiKeys : undefined,
  } as SecureStorageUpdateData

  return secureStorage.update(nextStorage)
}

export function getSavedCustomModels(): CustomModelConfig[] {
  return [...(getGlobalConfig().customModels ?? [])].sort((a, b) => {
    const activeName = getGlobalConfig().activeCustomModel
    if (a.name === activeName) return -1
    if (b.name === activeName) return 1
    return a.name.localeCompare(b.name)
  })
}

export function getActiveCustomModelName(): string | undefined {
  return getGlobalConfig().activeCustomModel
}

export function getSavedCustomModelByName(
  name: string,
): CustomModelConfig | undefined {
  const normalizedTarget = normalizeName(name)
  return getSavedCustomModels().find(
    model => normalizeName(model.name) === normalizedTarget,
  )
}

export function getSavedCustomModelByModelId(
  modelId: string,
): CustomModelConfig | undefined {
  const normalizedTarget = normalizeName(modelId)
  return getSavedCustomModels().find(
    model => normalizeName(model.model) === normalizedTarget,
  )
}

export function getActiveSavedCustomModel(): CustomModelConfig | null {
  const activeName = getActiveCustomModelName()
  if (!activeName) return null
  return getSavedCustomModelByName(activeName) ?? null
}

export function getSavedCustomModelApiKey(name: string): string | undefined {
  return getCustomModelApiKeys()[name]
}

export function findSavedCustomModel(
  nameOrModel: string | null | undefined,
): CustomModelConfig | null {
  if (!nameOrModel) {
    return getActiveSavedCustomModel()
  }

  return (
    getSavedCustomModelByName(nameOrModel) ??
    getSavedCustomModelByModelId(nameOrModel) ??
    null
  )
}

export function validateCustomModelUniqueness(
  candidate: Pick<CustomModelConfig, 'name' | 'model'>,
  currentName?: string,
): { valid: boolean; error?: string } {
  const normalizedCurrentName = currentName
    ? normalizeName(currentName)
    : undefined
  const normalizedName = normalizeName(candidate.name)
  const normalizedModelId = normalizeName(candidate.model)

  for (const existing of getSavedCustomModels()) {
    if (normalizeName(existing.name) === normalizedCurrentName) {
      continue
    }

    if (normalizeName(existing.name) === normalizedName) {
      return {
        valid: false,
        error: `A custom model named "${candidate.name}" already exists.`,
      }
    }

    if (normalizeName(existing.model) === normalizedModelId) {
      return {
        valid: false,
        error: `Model ID "${candidate.model}" is already used by "${existing.name}".`,
      }
    }
  }

  return { valid: true }
}

function removeCustomModelApiKey(name: string): void {
  const existingApiKeys = getCustomModelApiKeys()
  if (!(name in existingApiKeys)) {
    return
  }

  const { [name]: _discarded, ...remainingApiKeys } = existingApiKeys
  const rollbackResult = saveCustomModelApiKeys(remainingApiKeys)
  if (!rollbackResult.success) {
    logForDebugging(
      `Failed to remove custom model secret for ${name} from secure storage`,
      { level: 'warn' },
    )
  }
}

export function saveCustomModel(
  input: SaveCustomModelInput,
): SaveCustomModelResult {
  const name = input.name.trim()
  const model = input.model.trim()
  const baseURL = normalizeCustomModelBaseURL(input.baseURL)
  const provider = input.provider ?? 'openai'
  const apiMode = input.apiMode ?? 'chat_completions'

  if (!name) {
    return { success: false, error: 'Custom model name cannot be empty.' }
  }
  if (!model) {
    return { success: false, error: 'Model ID cannot be empty.' }
  }
  if (!baseURL) {
    return { success: false, error: 'Base URL cannot be empty.' }
  }
  if (!isValidUrl(baseURL)) {
    return { success: false, error: 'Base URL must be a valid URL.' }
  }

  const uniqueness = validateCustomModelUniqueness({ name, model })
  if (!uniqueness.valid) {
    return { success: false, error: uniqueness.error }
  }

  const now = Date.now()
  const savedModel: CustomModelConfig = {
    name,
    provider,
    baseURL,
    model,
    apiMode,
    createdAt: now,
    updatedAt: now,
    ...(input.maxTokens && { maxTokens: input.maxTokens }),
  }

  const apiKey = input.apiKey?.trim()
  let warning: string | undefined
  if (apiKey) {
    const saveResult = saveCustomModelApiKeys({
      ...getCustomModelApiKeys(),
      [savedModel.name]: apiKey,
    })
    if (!saveResult.success) {
      return {
        success: false,
        error: 'Failed to save the API key to secure storage.',
      }
    }
    warning = saveResult.warning
    if (warning) {
      logForDebugging(`Custom model secret save warning: ${warning}`, {
        level: 'warn',
      })
    }
  }

  try {
    saveGlobalConfig(current => ({
      ...current,
      customModels: [...(current.customModels ?? []), savedModel],
      activeCustomModel:
        input.activate === false ? current.activeCustomModel : savedModel.name,
    }))
  } catch (error) {
    if (apiKey) {
      removeCustomModelApiKey(savedModel.name)
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to save custom model metadata.',
    }
  }

  return { success: true, model: savedModel, warning }
}

export function setActiveCustomModel(name: string | null): void {
  if (name === null) {
    saveGlobalConfig(current => ({
      ...current,
      activeCustomModel: undefined,
    }))
    return
  }

  const matchedModel = getSavedCustomModelByName(name)
  if (!matchedModel) {
    throw new Error(`Unknown custom model: ${name}`)
  }

  saveGlobalConfig(current => ({
    ...current,
    activeCustomModel: matchedModel.name,
  }))
}

export function deleteCustomModel(name: string): void {
  const matchedModel = getSavedCustomModelByName(name)
  if (!matchedModel) {
    return
  }

  saveGlobalConfig(current => {
    const remainingModels = (current.customModels ?? []).filter(
      model => normalizeName(model.name) !== normalizeName(name),
    )
    return {
      ...current,
      customModels: remainingModels,
      activeCustomModel:
        current.activeCustomModel === matchedModel.name
          ? undefined
          : current.activeCustomModel,
    }
  })

  removeCustomModelApiKey(matchedModel.name)
}

export function getEnvCustomModelConfig(): ResolvedCustomModelConfig | null {
  const provider = getConfiguredCompatibleProvider()
  if (!provider) {
    return null
  }

  const baseURL =
    process.env[LATTE_BASE_URL_ENV]?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim()
  const model =
    process.env[LATTE_MODEL_ENV]?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim()
  if (!baseURL || !model || !isValidUrl(baseURL)) {
    return null
  }

  return {
    name: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME?.trim() || model,
    provider,
    baseURL: normalizeCustomModelBaseURL(baseURL),
    model,
    apiMode: normalizeOpenAICompatibleMode(process.env[OPENAI_COMPAT_MODE_ENV]),
    createdAt: 0,
    updatedAt: 0,
    apiKey: getPreferredCustomModelApiKey(),
    source: 'env',
    isActive: true,
  }
}

export function hasSavedCustomModelConfiguration(): boolean {
  return (getGlobalConfig().customModels?.length ?? 0) > 0
}

function hasHigherPriorityCustomModelEnvironment(): boolean {
  return Boolean(
    process.env[LATTE_API_KEY_ENV]?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env[CUSTOM_MODEL_API_KEY_ENV]?.trim() ||
      process.env[COMPATIBLE_PROVIDER_ENV]?.trim() ||
      process.env[LATTE_BASE_URL_ENV]?.trim() ||
      process.env[LATTE_MODEL_ENV]?.trim() ||
      process.env.ANTHROPIC_BASE_URL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim(),
  )
}

export function applyPersistedCustomModelEnvironment(): boolean {
  if (hasHigherPriorityCustomModelEnvironment()) {
    return false
  }

  const savedConfig = getSavedResolvedCustomModel()
  if (!savedConfig) {
    return false
  }

  process.env[COMPATIBLE_PROVIDER_ENV] = savedConfig.provider
  process.env[LATTE_BASE_URL_ENV] = savedConfig.baseURL
  process.env[LATTE_MODEL_ENV] = savedConfig.model
  process.env.ANTHROPIC_BASE_URL = savedConfig.baseURL
  process.env.ANTHROPIC_MODEL = savedConfig.model
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = savedConfig.name
  process.env[OPENAI_COMPAT_MODE_ENV] = savedConfig.apiMode

  if (savedConfig.apiKey?.trim()) {
    process.env[LATTE_API_KEY_ENV] = savedConfig.apiKey
    process.env[CUSTOM_MODEL_API_KEY_ENV] = savedConfig.apiKey
  }

  return true
}

export function getSavedResolvedCustomModel(
  nameOrModel?: string | null,
): ResolvedCustomModelConfig | null {
  const matchedModel = findSavedCustomModel(nameOrModel)
  if (!matchedModel) {
    return null
  }

  return {
    ...matchedModel,
    apiKey: getSavedCustomModelApiKey(matchedModel.name),
    source: 'saved',
    isActive: matchedModel.name === getActiveCustomModelName(),
  }
}

function matchesResolvedCustomModel(
  config: ResolvedCustomModelConfig,
  nameOrModel: string,
): boolean {
  const normalizedTarget = normalizeName(nameOrModel)
  return (
    normalizeName(config.name) === normalizedTarget ||
    normalizeName(config.model) === normalizedTarget
  )
}

export function getResolvedCustomModelConfig(
  nameOrModel?: string | null,
): ResolvedCustomModelConfig | null {
  const envConfig = getEnvCustomModelConfig()

  if (nameOrModel) {
    if (envConfig && matchesResolvedCustomModel(envConfig, nameOrModel)) {
      return envConfig
    }

    return getSavedResolvedCustomModel(nameOrModel)
  }

  if (envConfig) {
    return envConfig
  }

  if (
    process.env.ANTHROPIC_API_KEY?.trim() &&
    !process.env[LATTE_API_KEY_ENV]?.trim()
  ) {
    return null
  }

  return getSavedResolvedCustomModel(nameOrModel)
}

export function getCompatibleModelConfig(
  nameOrModel?: string | null,
): ResolvedCustomModelConfig | null {
  return getResolvedCustomModelConfig(nameOrModel)
}

function buildCompatibleModelOption(
  config: ResolvedCustomModelConfig,
): ModelOption {
  const sourceLabel = config.source === 'env' ? 'env override' : 'saved model'
  const activeLabel = config.isActive ? 'active' : sourceLabel

  return {
    value: config.model,
    label: config.name,
    description: `${activeLabel} · ${config.model} · ${config.baseURL}`,
    descriptionForModel: `${config.name} (${config.model})`,
  }
}

export function getConfiguredCompatibleModelOptions(): ModelOption[] {
  const options: ModelOption[] = []
  const seenModels = new Set<string>()

  const pushConfig = (config: ResolvedCustomModelConfig | null) => {
    if (!config) {
      return
    }

    const normalizedModel = normalizeName(config.model)
    if (seenModels.has(normalizedModel)) {
      return
    }

    seenModels.add(normalizedModel)
    options.push(buildCompatibleModelOption(config))
  }

  pushConfig(getEnvCustomModelConfig())

  for (const savedModel of getSavedCustomModels()) {
    pushConfig(getSavedResolvedCustomModel(savedModel.name))
  }

  return options
}

export function hasCustomModelConfiguration(
  nameOrModel?: string | null,
): boolean {
  return getResolvedCustomModelConfig(nameOrModel) !== null
}

// ---------------------------------------------------------------------------
// Model Presets – built-in templates for popular Chinese AI providers
// ---------------------------------------------------------------------------

export type ModelPreset = {
  readonly name: string
  readonly provider: CustomModelProvider
  readonly model: string
  readonly baseURL: string
  readonly apiMode: OpenAICompatibleMode
  readonly description: string
  readonly maxTokens?: number
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
  // DeepSeek
  {
    name: 'DeepSeek Chat',
    provider: 'openai',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
    apiMode: 'chat_completions',
    description: 'DeepSeek V3 通用对话模型',
    maxTokens: 16384,
  },
  {
    name: 'DeepSeek V4 Pro',
    provider: 'openai',
    model: 'deepseek-v4-pro',
    baseURL: 'https://api.deepseek.com/v1',
    apiMode: 'chat_completions',
    description: 'DeepSeek V4 Pro 高级模型',
    maxTokens: 16384,
  },
  {
    name: 'DeepSeek Reasoner',
    provider: 'openai',
    model: 'deepseek-reasoner',
    baseURL: 'https://api.deepseek.com/v1',
    apiMode: 'chat_completions',
    description: 'DeepSeek R1 推理模型',
    maxTokens: 16384,
  },
  // Kimi (Moonshot)
  {
    name: 'Kimi K2.5',
    provider: 'openai',
    model: 'kimi-k2.5',
    baseURL: 'https://api.moonshot.cn/v1',
    apiMode: 'chat_completions',
    description: '月之暗面 Kimi K2.5',
    maxTokens: 131072,
  },
  {
    name: 'Kimi K2',
    provider: 'openai',
    model: 'kimi-k2',
    baseURL: 'https://api.moonshot.cn/v1',
    apiMode: 'chat_completions',
    description: '月之暗面 Kimi K2',
    maxTokens: 131072,
  },
  // GLM (Zhipu AI)
  {
    name: 'GLM-4-Plus',
    provider: 'openai',
    model: 'glm-4-plus',
    baseURL: 'https://open.bigmodel.cn/api/paas/v1',
    apiMode: 'chat_completions',
    description: '智谱 GLM-4-Plus',
    maxTokens: 16384,
  },
  {
    name: 'GLM-4-Flash',
    provider: 'openai',
    model: 'glm-4-flash',
    baseURL: 'https://open.bigmodel.cn/api/paas/v1',
    apiMode: 'chat_completions',
    description: '智谱 GLM-4-Flash（免费）',
    maxTokens: 4096,
  },
  // Qwen (Alibaba Cloud)
  {
    name: 'Qwen-Max',
    provider: 'openai',
    model: 'qwen-max',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiMode: 'chat_completions',
    description: '通义千问 Qwen-Max',
    maxTokens: 32768,
  },
  {
    name: 'Qwen-Plus',
    provider: 'openai',
    model: 'qwen-plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiMode: 'chat_completions',
    description: '通义千问 Qwen-Plus',
    maxTokens: 32768,
  },
  {
    name: 'Qwen3-Coder',
    provider: 'openai',
    model: 'qwen3-coder-plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiMode: 'chat_completions',
    description: '通义千问 Qwen3 Coder 编程模型',
    maxTokens: 32768,
  },
  // MiMo (Xiaomi)
  {
    name: 'MiMo-V2.5-Pro',
    provider: 'openai',
    model: 'mimo-v2.5-pro',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    apiMode: 'chat_completions',
    description: '小米 MiMo V2.5 Pro',
  },
  // Hunyuan (Tencent)
  {
    name: 'Hunyuan-T1',
    provider: 'openai',
    model: 'hunyuan-t1-latest',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiMode: 'chat_completions',
    description: '腾讯混元 T1 推理模型',
    maxTokens: 16384,
  },
  // Doubao (ByteDance / Volcengine)
  {
    name: 'Doubao-1.5-Pro',
    provider: 'openai',
    model: 'doubao-1.5-pro-256k',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiMode: 'chat_completions',
    description: '字节豆包 1.5 Pro（需填入 Endpoint ID 作为 model）',
    maxTokens: 32768,
  },
  // Ollama (local)
  {
    name: 'Ollama (本地)',
    provider: 'openai',
    model: 'qwen3:8b',
    baseURL: 'http://localhost:11434/v1',
    apiMode: 'chat_completions',
    description: 'Ollama 本地模型（需先启动 Ollama）',
  },
] as const

/**
 * Find a preset by name (case-insensitive).
 */
export function findModelPreset(name: string): ModelPreset | undefined {
  const normalized = normalizeName(name)
  return MODEL_PRESETS.find(p => normalizeName(p.name) === normalized)
}

/**
 * Check if a model name or model ID matches an existing saved model.
 * Used by the preset flow to skip already-configured models.
 */
export function isPresetAlreadySaved(preset: ModelPreset): boolean {
  const saved = getSavedCustomModels()
  return saved.some(
    m =>
      normalizeName(m.name) === normalizeName(preset.name) ||
      normalizeName(m.model) === normalizeName(preset.model),
  )
}

// ---------------------------------------------------------------------------
// updateCustomModel – edit an existing saved model's fields
// ---------------------------------------------------------------------------

export type UpdateCustomModelInput = {
  baseURL?: string
  model?: string
  apiKey?: string
  apiMode?: OpenAICompatibleMode
}

export function updateCustomModel(
  name: string,
  updates: UpdateCustomModelInput,
): SaveCustomModelResult {
  const existing = getSavedCustomModelByName(name)
  if (!existing) {
    return { success: false, error: `Custom model "${name}" not found.` }
  }

  // Validate new model ID uniqueness if changing
  if (updates.model && normalizeName(updates.model) !== normalizeName(existing.model)) {
    const uniqueness = validateCustomModelUniqueness(
      { name: existing.name, model: updates.model },
      existing.name,
    )
    if (!uniqueness.valid) {
      return { success: false, error: uniqueness.error }
    }
  }

  // Validate new baseURL if changing
  if (updates.baseURL) {
    const normalized = normalizeCustomModelBaseURL(updates.baseURL)
    if (!isValidUrl(normalized)) {
      return { success: false, error: 'Base URL must be a valid URL.' }
    }
  }

  // Update API key if provided
  let warning: string | undefined
  if (updates.apiKey !== undefined) {
    const apiKey = updates.apiKey.trim()
    if (apiKey) {
      const allKeys = getCustomModelApiKeys()
      allKeys[existing.name] = apiKey
      const saveResult = saveCustomModelApiKeys(allKeys)
      if (!saveResult.success) {
        return {
          success: false,
          error: 'Failed to update the API key in secure storage.',
        }
      }
      warning = saveResult.warning
    } else {
      // Empty string means remove the key
      removeCustomModelApiKey(existing.name)
    }
  }

  // Update metadata in settings.json
  const updatedModel: CustomModelConfig = {
    ...existing,
    ...(updates.baseURL && { baseURL: normalizeCustomModelBaseURL(updates.baseURL) }),
    ...(updates.model && { model: updates.model.trim() }),
    ...(updates.apiMode && { apiMode: updates.apiMode }),
    updatedAt: Date.now(),
  }

  try {
    saveGlobalConfig(current => ({
      ...current,
      customModels: (current.customModels ?? []).map(m =>
        normalizeName(m.name) === normalizeName(name) ? updatedModel : m,
      ),
    }))
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to update custom model metadata.',
    }
  }

  return { success: true, model: updatedModel, warning }
}
