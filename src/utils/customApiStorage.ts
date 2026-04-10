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
