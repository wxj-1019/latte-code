// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
} from '@anthropic-ai/sdk'
import { MODEL_ALIASES } from './aliases.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getModelStrings } from './modelStrings.js'
import { getOpenAISubMode } from './providers.js'
import { sideQuery } from '../sideQuery.js'
import {
  getResolvedCustomModelConfig,
  normalizeCustomModelBaseURL,
  type ResolvedCustomModelConfig,
} from '../customApiStorage.js'

// Cache valid models to avoid repeated API calls
const validModelCache = new Map<string, boolean>()

export type CompatibleModelValidationInput = {
  name: string
  baseURL: string
  model: string
  apiKey?: string
}

function buildCompatibleValidationEndpoint(baseURL: string): string {
  const normalizedBaseURL = normalizeCustomModelBaseURL(baseURL)
  return normalizedBaseURL.endsWith('/chat/completions')
    ? normalizedBaseURL
    : `${normalizedBaseURL}/chat/completions`
}

function extractCompatibleErrorMessage(
  responseBody: string,
  fallbackMessage: string,
): string {
  try {
    const parsed = JSON.parse(responseBody) as
      | { error?: { message?: string }; message?: string }
      | undefined
    return (
      parsed?.error?.message?.trim() ||
      parsed?.message?.trim() ||
      fallbackMessage
    )
  } catch {
    return responseBody.trim() || fallbackMessage
  }
}

export async function validateCompatibleModelConfig(
  input: CompatibleModelValidationInput,
): Promise<{ valid: boolean; error?: string }> {
  const baseURL = normalizeCustomModelBaseURL(input.baseURL)
  const model = input.model.trim()
  const name = input.name.trim() || model

  if (!baseURL) {
    return { valid: false, error: 'Base URL cannot be empty.' }
  }
  if (!model) {
    return { valid: false, error: 'Model ID cannot be empty.' }
  }

  try {
    new URL(baseURL)
  } catch {
    return { valid: false, error: 'Base URL must be a valid URL.' }
  }

  try {
    const response = await fetch(buildCompatibleValidationEndpoint(baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(input.apiKey?.trim()
          ? { Authorization: `Bearer ${input.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })

    if (response.ok) {
      return { valid: true }
    }

    const responseBody = await response.text()
    const message = extractCompatibleErrorMessage(
      responseBody,
      `Compatible API error (${response.status})`,
    )

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: `Authentication failed for "${name}". Check the API key.`,
      }
    }

    if (response.status === 404) {
      return {
        valid: false,
        error: `Model "${model}" was not found at ${baseURL}.`,
      }
    }

    return {
      valid: false,
      error: `Failed to validate "${name}": ${message}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      valid: false,
      error: `Unable to reach ${baseURL}: ${message}`,
    }
  }
}

/**
 * Validates a model by attempting an actual API call.
 */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()
  const compatibleConfig = getResolvedCustomModelConfig(normalizedModel)

  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  if (!isModelAllowed(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  const lowerModel = normalizedModel.toLowerCase()
  if ((MODEL_ALIASES as readonly string[]).includes(lowerModel)) {
    return { valid: true }
  }

  const { isCodexSubscriber } = await import('../auth.js')
  const { isCodexModel } = await import(
    '../../services/api/codex-fetch-adapter.js'
  )
  if (isCodexSubscriber() && isCodexModel(normalizedModel)) {
    validModelCache.set(normalizedModel, true)
    return { valid: true }
  }

  if (
    getOpenAISubMode(normalizedModel) === 'compatible' &&
    compatibleConfig === null
  ) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' does not have a saved OpenAI-compatible configuration`,
    }
  }

  if (
    normalizedModel === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION &&
    compatibleConfig === null
  ) {
    return { valid: true }
  }

  if (validModelCache.has(normalizedModel)) {
    return { valid: true }
  }

  try {
    await sideQuery({
      model: normalizedModel,
      max_tokens: 1,
      maxRetries: 0,
      querySource: 'model_validation',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hi',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    })

    validModelCache.set(normalizedModel, true)
    return { valid: true }
  } catch (error) {
    return handleValidationError(error, normalizedModel, compatibleConfig)
  }
}

function handleValidationError(
  error: unknown,
  modelName: string,
  compatibleConfig: ResolvedCustomModelConfig | null,
): { valid: boolean; error: string } {
  if (compatibleConfig) {
    if (error instanceof NotFoundError) {
      return {
        valid: false,
        error: `Model "${compatibleConfig.model}" is not available at ${compatibleConfig.baseURL}.`,
      }
    }

    if (error instanceof AuthenticationError) {
      return {
        valid: false,
        error: `Authentication failed for "${compatibleConfig.name}". Check the API key.`,
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: `Unable to connect to ${compatibleConfig.baseURL}. Check the base URL and network.`,
      }
    }

    if (error instanceof APIError) {
      return {
        valid: false,
        error: `Failed to validate "${compatibleConfig.name}": ${error.message}`,
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      valid: false,
      error: `Unable to validate "${compatibleConfig.name}": ${message}`,
    }
  }

  if (error instanceof NotFoundError) {
    const fallback = get3PFallbackSuggestion(modelName)
    const suggestion = fallback ? `. Try '${fallback}' instead` : ''
    return {
      valid: false,
      error: `Model '${modelName}' not found${suggestion}`,
    }
  }

  if (error instanceof APIError) {
    if (error instanceof AuthenticationError) {
      return {
        valid: false,
        error: 'Authentication failed. Please check your API credentials.',
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
      }
    }

    const errorBody = error.error as unknown
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'type' in errorBody &&
      errorBody.type === 'not_found_error' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string' &&
      errorBody.message.includes('model:')
    ) {
      return { valid: false, error: `Model '${modelName}' not found` }
    }

    return { valid: false, error: `API error: ${error.message}` }
  }

  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}

// @[MODEL LAUNCH]: Add a fallback suggestion chain for the new model -> previous version
/**
 * Suggest a fallback model for 3P users when the selected model is unavailable.
 */
function get3PFallbackSuggestion(model: string): string | undefined {
  if (getOpenAISubMode(model) === 'compatible') {
    return undefined
  }

  const lowerModel = model.toLowerCase()
  if (lowerModel.includes('opus-4-6') || lowerModel.includes('opus_4_6')) {
    return getModelStrings().opus41
  }
  if (lowerModel.includes('sonnet-4-6') || lowerModel.includes('sonnet_4_6')) {
    return getModelStrings().sonnet45
  }
  if (lowerModel.includes('sonnet-4-5') || lowerModel.includes('sonnet_4_5')) {
    return getModelStrings().sonnet40
  }
  return undefined
}
