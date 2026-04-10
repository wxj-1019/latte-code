import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getResolvedCustomModelConfig } from '../customApiStorage.js'
import { isEnvTruthy } from '../envUtils.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openai'
export type OpenAISubMode = 'codex' | 'compatible'

function getResolvedCustomModelConfigSafe(model?: string | null) {
  try {
    return getResolvedCustomModelConfig(model)
  } catch {
    return null
  }
}

function getRequestedModelForProvider(): string | null {
  const sessionOverride = getMainLoopModelOverride()
  if (typeof sessionOverride === 'string') {
    return sessionOverride
  }

  const settings = getSettings_DEPRECATED() || {}
  return process.env.ANTHROPIC_MODEL ?? settings.model ?? null
}

export function getOpenAISubMode(model?: string | null): OpenAISubMode | null {
  const requestedModel = model ?? getRequestedModelForProvider()

  if (requestedModel) {
    if (getResolvedCustomModelConfigSafe(requestedModel)) {
      return 'compatible'
    }
  } else if (getResolvedCustomModelConfigSafe()) {
    return 'compatible'
  }

  return isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI) ? 'codex' : null
}

export function isOpenAICompatibleProvider(model?: string | null): boolean {
  return getOpenAISubMode(model) === 'compatible'
}

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : getOpenAISubMode()
          ? 'openai'
          : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  const openAISubMode = getOpenAISubMode()
  if (openAISubMode === 'compatible') {
    return 'openai-compatible' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
  if (openAISubMode === 'codex') {
    return 'openai-codex' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
