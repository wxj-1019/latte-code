import React, { useCallback, useState } from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  normalizeCustomModelBaseURL,
  normalizeOpenAICompatibleMode,
  saveCustomModel,
  type SaveCustomModelResult,
  MODEL_PRESETS,
  isPresetAlreadySaved,
} from '../utils/customApiStorage.js'
import { validateCompatibleModelConfig } from '../utils/model/validateModel.js'
import { Select } from './CustomSelect/select.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Step =
  | { type: 'preset' }
  | { type: 'name'; value: string }
  | { type: 'baseURL'; value: string }
  | { type: 'model'; value: string }
  | { type: 'apiKey'; value: string }
  | { type: 'mode'; value: 'chat_completions' | 'responses' }
  | { type: 'validating' }
  | { type: 'saving' }
  | { type: 'success'; result: SaveCustomModelResult }
  | { type: 'error'; message: string }

type Props = {
  initialName?: string
  onDone: (
    result?: string,
    options?: { display?: 'skip' | 'system' | 'user' },
  ) => void
  onSuccess?: (result: SaveCustomModelResult) => void
  onCancel?: () => void
  completeOnCancel?: boolean
}

const PASTE_HERE_MSG = '> '

export function CustomModelSetupFlow({
  initialName,
  onDone,
  onSuccess,
  onCancel,
  completeOnCancel = true,
}: Props): React.ReactNode {
  // Register Confirmation context to enable confirm:* keybindings
  useRegisterKeybindingContext('Confirmation')

  const terminal = useTerminalSize()
  const textInputColumns = Math.max(
    20,
    terminal.columns - PASTE_HERE_MSG.length - 1,
  )

  const [steps, setSteps] = useState<Step[]>([
    { type: 'preset' },
  ])
  const [cursorOffset, setCursorOffset] = useState(0)
  const currentStep = steps[steps.length - 1]!

  const pushStep = useCallback((step: Step) => {
    setSteps(prev => [...prev, step])
    setCursorOffset(0)
  }, [])

  const updateCurrentStepValue = useCallback((value: string) => {
    setSteps(prev => {
      const last = prev[prev.length - 1]
      if (
        !last ||
        !('value' in last) ||
        (last.type !== 'name' &&
          last.type !== 'baseURL' &&
          last.type !== 'model' &&
          last.type !== 'apiKey')
      ) {
        return prev
      }

      return [...prev.slice(0, -1), { ...last, value }]
    })
  }, [])

  const goBack = useCallback(() => {
    setSteps(prev => {
      if (prev.length <= 1) return prev

      // In preset flow: allow stepping back through pre-filled steps
      // but return to preset page only from the name step
      const hasPresetStep = prev.some(s => s.type === 'preset')
      if (hasPresetStep) {
        const presetIndex = prev.findIndex(s => s.type === 'preset')
        // Only go back to preset if we're at the name step
        // (i.e., name is the only step after preset)
        if (prev.length === presetIndex + 2 && prev[presetIndex + 1]?.type === 'name') {
          return prev.slice(0, presetIndex + 1)
        }
        // Otherwise, go back one step normally (allow editing pre-filled values)
        return prev.slice(0, -1)
      }

      return prev.slice(0, -1)
    })
    setCursorOffset(0)
  }, [])

  const collectValues = useCallback(() => {
    const values = {
      name: '',
      baseURL: '',
      model: '',
      apiKey: '',
    }

    for (const step of steps) {
      if (step.type === 'name') values.name = step.value.trim()
      if (step.type === 'baseURL') values.baseURL = step.value.trim()
      if (step.type === 'model') values.model = step.value.trim()
      if (step.type === 'apiKey') values.apiKey = step.value.trim()
    }

    return values
  }, [steps])

  const handlePresetSelect = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        // Manual flow: start with name input
        pushStep({ type: 'name', value: initialName ?? '' })
        return
      }

      // Find the selected preset
      const preset = MODEL_PRESETS.find(p => p.name === value)
      if (!preset) {
        pushStep({ type: 'name', value: initialName ?? '' })
        return
      }

      // Pre-fill all values from preset, jump directly to apiKey input
      // Store preset info in the steps so collectValues can read them
      setSteps(prev => [
        ...prev,
        { type: 'name', value: preset.name },
        { type: 'baseURL', value: preset.baseURL },
        { type: 'model', value: preset.model },
        { type: 'apiKey', value: '' },
      ])
      setCursorOffset(0)
    },
    [initialName, pushStep],
  )

  const handleNameSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) {
        pushStep({ type: 'error', message: 'Custom model name cannot be empty.' })
        return
      }
      pushStep({ type: 'baseURL', value: '' })
    },
    [pushStep],
  )

  const handleBaseURLSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) {
        pushStep({ type: 'error', message: 'Base URL cannot be empty.' })
        return
      }

      try {
        new URL(trimmed)
        pushStep({ type: 'model', value: '' })
      } catch {
        pushStep({ type: 'error', message: 'Base URL must be a valid URL.' })
      }
    },
    [pushStep],
  )

  const handleModelSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) {
        pushStep({ type: 'error', message: 'Model ID cannot be empty.' })
        return
      }
      pushStep({ type: 'apiKey', value: '' })
    },
    [pushStep],
  )

  const handleApiKeySubmit = useCallback(() => {
    const isPresetFlow = steps.some(s => s.type === 'preset')
    if (isPresetFlow) {
      // Preset flow: skip mode selection (always chat_completions), go straight to validation
      const values = collectValues()
      const normalizedBaseURL = normalizeCustomModelBaseURL(values.baseURL)

      setSteps(prev => [...prev, { type: 'validating' }])

      void (async () => {
        const validation = await validateCompatibleModelConfig({
          name: values.name,
          baseURL: normalizedBaseURL,
          model: values.model,
          apiKey: values.apiKey || undefined,
        })

        if (!validation.valid) {
          setSteps(prev => [
            ...prev.slice(0, -1),
            {
              type: 'error',
              message: validation.error ?? 'Failed to validate the custom model.',
            },
          ])
          return
        }

        setSteps(prev => [...prev.slice(0, -1), { type: 'saving' }])

        // Find preset to get maxTokens if available
        const preset = MODEL_PRESETS.find(p => p.name === values.name)

        const result = saveCustomModel({
          name: values.name,
          provider: 'openai',
          baseURL: normalizedBaseURL,
          model: values.model,
          apiMode: 'chat_completions',
          apiKey: values.apiKey || undefined,
          activate: true,
          ...(preset?.maxTokens && { maxTokens: preset.maxTokens }),
        })

        if (result.success) {
          onSuccess?.(result)
          finishSuccess(result)
        } else {
          setSteps(prev => [
            ...prev.slice(0, -1),
            { type: 'error', message: result.error ?? 'Failed to save the custom model.' },
          ])
        }
      })()
    } else {
      // Manual flow: proceed to mode selection
      pushStep({ type: 'mode', value: 'chat_completions' })
    }
  }, [collectValues, normalizeCustomModelBaseURL, onSuccess, finishSuccess, pushStep, steps])

  const finishSuccess = useCallback(
    (result: SaveCustomModelResult) => {
      const savedModel = result.model
      const message = savedModel
        ? `Added custom model ${savedModel.name} (${savedModel.model}).`
        : 'Added custom model.'
      onDone(message, { display: 'system' })
    },
    [onDone],
  )

  const handleModeSelect = useCallback(
    (mode: string) => {
      const normalizedMode = normalizeOpenAICompatibleMode(mode)
      const values = collectValues()
      const normalizedBaseURL = normalizeCustomModelBaseURL(values.baseURL)

      setSteps(prev => [...prev, { type: 'validating' }])

      void (async () => {
        const validation = await validateCompatibleModelConfig({
          name: values.name,
          baseURL: normalizedBaseURL,
          model: values.model,
          apiKey: values.apiKey || undefined,
        })

        if (!validation.valid) {
          setSteps(prev => [
            ...prev.slice(0, -1),
            {
              type: 'error',
              message: validation.error ?? 'Failed to validate the custom model.',
            },
          ])
          return
        }

        setSteps(prev => [...prev.slice(0, -1), { type: 'saving' }])

        const result = saveCustomModel({
          name: values.name,
          provider: 'openai',
          baseURL: normalizedBaseURL,
          model: values.model,
          apiMode: normalizedMode,
          apiKey: values.apiKey || undefined,
          activate: true,
        })

        if (result.success) {
          onSuccess?.(result)
          setSteps(prev => [...prev.slice(0, -1), { type: 'success', result }])
          return
        }

        setSteps(prev => [
          ...prev.slice(0, -1),
          {
            type: 'error',
            message: result.error ?? 'Failed to save the custom model.',
          },
        ])
      })()
    },
    [collectValues, onSuccess],
  )

  const handleDone = useCallback(() => {
    if (currentStep.type === 'success') {
      finishSuccess(currentStep.result)
      return
    }
    onDone(undefined, { display: 'skip' })
  }, [currentStep, finishSuccess, onDone])

  const handleCancel = useCallback(() => {
    if (steps.length > 1) {
      goBack()
      return
    }

    onCancel?.()
    if (completeOnCancel) {
      onDone('Cancelled custom model setup.', { display: 'system' })
    }
  }, [completeOnCancel, goBack, onCancel, onDone, steps.length])

  useKeybinding(
    'confirm:no',
    () => {
      if (currentStep.type !== 'saving' && currentStep.type !== 'validating') {
        handleCancel()
      }
    },
    { isActive: true, context: 'Confirmation' },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      if (currentStep.type === 'success') {
        handleDone()
      }
    },
    { isActive: currentStep.type === 'success', context: 'Confirmation' },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      if (currentStep.type === 'error') {
        goBack()
      }
    },
    { isActive: currentStep.type === 'error', context: 'Confirmation' },
  )

  const renderStep = (): React.ReactNode => {
    switch (currentStep.type) {
      case 'preset': {
        const presetOptions = MODEL_PRESETS.map(preset => ({
          label: `${preset.name}${isPresetAlreadySaved(preset) ? ' (已配置)' : ''}`,
          value: preset.name,
          description: `${preset.description} · ${preset.model}`,
        }))
        presetOptions.push({
          label: '自定义模型...',
          value: '__custom__',
          description: '手动输入所有配置信息',
        })
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>添加 OpenAI 兼容模型</Text>
            <Text>选择一个预设模板，或选择"自定义"手动配置。</Text>
            <Box marginTop={1}>
              <Select
                options={presetOptions}
                onChange={handlePresetSelect}
                onCancel={handleCancel}
                visibleOptionCount={10}
              />
            </Box>
            <Text dimColor>使用方向键选择，Enter 确认，Esc 取消。</Text>
          </Box>
        )
      }

      case 'name': {
        const isPresetFlow = steps.some(s => s.type === 'preset')
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>{isPresetFlow ? '确认模型名称' : 'Add OpenAI-compatible model'}</Text>
            {isPresetFlow ? (
              <Text>预设已自动填充名称，可以修改后按 Enter。</Text>
            ) : (
              <Text>Enter a display name for this model.</Text>
            )}
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={currentStep.value}
                onChange={updateCurrentStepValue}
                onSubmit={handleNameSubmit}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                focus
              />
            </Box>
            <Text dimColor>按 Enter 继续，按 Esc 返回选择预设。</Text>
          </Box>
        )
      }

      case 'baseURL': {
        const isPresetFlow = steps.some(s => s.type === 'preset')
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>{isPresetFlow ? '确认 API 端点' : 'Configure endpoint'}</Text>
            {isPresetFlow ? (
              <Text>预设已自动填充端点地址，可以修改后按 Enter。</Text>
            ) : (
              <Text>Enter the provider base URL, for example `https://api.deepseek.com`.</Text>
            )}
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={currentStep.value}
                onChange={updateCurrentStepValue}
                onSubmit={handleBaseURLSubmit}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                focus
              />
            </Box>
            <Text dimColor>{isPresetFlow ? '按 Enter 继续，按 Esc 返回上一步。' : 'Press Enter to continue, or Esc to go back.'}</Text>
          </Box>
        )
      }

      case 'model': {
        const isPresetFlow = steps.some(s => s.type === 'preset')
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>{isPresetFlow ? '确认模型 ID' : 'Configure model ID'}</Text>
            {isPresetFlow ? (
              <Text>预设已自动填充模型 ID，可以修改后按 Enter。</Text>
            ) : (
              <Text>Enter the upstream model ID, for example `deepseek-chat`.</Text>
            )}
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={currentStep.value}
                onChange={updateCurrentStepValue}
                onSubmit={handleModelSubmit}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                focus
              />
            </Box>
            <Text dimColor>{isPresetFlow ? '按 Enter 继续，按 Esc 返回上一步。' : 'Press Enter to continue, or Esc to go back.'}</Text>
          </Box>
        )
      }

      case 'apiKey': {
        const isPresetFlow = steps.some(s => s.type === 'preset')
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>{isPresetFlow ? '配置 API Key' : 'Configure API key'}</Text>
            {isPresetFlow ? (
              <Text>请输入该模型的 API Key。</Text>
            ) : (
              <Text>Enter an API key, or leave it blank to use `DOGE_API_KEY`.</Text>
            )}
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={currentStep.value}
                onChange={updateCurrentStepValue}
                onSubmit={handleApiKeySubmit}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                mask="*"
                focus
              />
            </Box>
            <Text dimColor>{isPresetFlow ? '按 Enter 继续，按 Esc 返回选择预设。' : 'Press Enter to continue, or Esc to go back.'}</Text>
          </Box>
        )
      }

      case 'mode':
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Select compatibility mode</Text>
            <Text>Choose which OpenAI-compatible endpoint shape to use.</Text>
            <Box marginTop={1}>
              <Select
                options={[
                  {
                    label: 'Chat Completions',
                    value: 'chat_completions',
                    description:
                      'Use /chat/completions. Recommended for the broadest compatibility.',
                  },
                  {
                    label: 'Responses',
                    value: 'responses',
                    description:
                      'Use the Responses-style configuration. The adapter still validates against chat completions today.',
                  },
                ]}
                onChange={handleModeSelect}
                onCancel={handleCancel}
                visibleOptionCount={5}
              />
            </Box>
            <Text dimColor>Use arrow keys to choose, Enter to confirm, or Esc to go back.</Text>
          </Box>
        )

      case 'validating':
        return (
          <Box flexDirection="column" gap={1}>
            <Box>
              <Spinner />
              <Text>Validating the custom endpoint...</Text>
            </Box>
          </Box>
        )

      case 'saving':
        return (
          <Box flexDirection="column" gap={1}>
            <Box>
              <Spinner />
              <Text>Saving the custom model...</Text>
            </Box>
          </Box>
        )

      case 'success':
        return (
          <Box flexDirection="column" gap={1}>
            <Text color="success">Custom model saved successfully.</Text>
            {currentStep.result.model ? (
              <Box flexDirection="column" gap={1} marginLeft={2}>
                <Text>Name: <Text bold>{currentStep.result.model.name}</Text></Text>
                <Text>Model ID: <Text bold>{currentStep.result.model.model}</Text></Text>
                <Text>Base URL: <Text bold>{currentStep.result.model.baseURL}</Text></Text>
                <Text>Mode: <Text bold>{currentStep.result.model.apiMode}</Text></Text>
              </Box>
            ) : null}
            {currentStep.result.warning ? (
              <Text color="warning">{currentStep.result.warning}</Text>
            ) : null}
            <Text dimColor>Press Enter to finish.</Text>
          </Box>
        )

      case 'error':
        return (
          <Box flexDirection="column" gap={1}>
            <Text color="error">Custom model setup failed.</Text>
            <Text>{currentStep.message}</Text>
            <Text dimColor>Press Enter to go back and edit the previous step.</Text>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      {renderStep()}
    </Box>
  )
}
