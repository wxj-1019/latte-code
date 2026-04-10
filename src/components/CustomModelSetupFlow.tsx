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
} from '../utils/customApiStorage.js'
import { validateCompatibleModelConfig } from '../utils/model/validateModel.js'
import { Select } from './CustomSelect/select.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Step =
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
    { type: 'name', value: initialName ?? '' },
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
    setSteps(prev => (prev.length <= 1 ? prev : prev.slice(0, -1)))
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
    pushStep({ type: 'mode', value: 'chat_completions' })
  }, [pushStep])

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
    'global:cancel',
    () => {
      if (currentStep.type !== 'saving' && currentStep.type !== 'validating') {
        handleCancel()
      }
    },
    { isActive: true },
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
      case 'name':
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Add OpenAI-compatible model</Text>
            <Text>Enter a display name for this model.</Text>
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
            <Text dimColor>Press Enter to continue, or Esc to cancel.</Text>
          </Box>
        )

      case 'baseURL':
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Configure endpoint</Text>
            <Text>Enter the provider base URL, for example `https://api.deepseek.com`.</Text>
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
            <Text dimColor>Press Enter to continue, or Esc to go back.</Text>
          </Box>
        )

      case 'model':
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Configure model ID</Text>
            <Text>Enter the upstream model ID, for example `deepseek-chat`.</Text>
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
            <Text dimColor>Press Enter to continue, or Esc to go back.</Text>
          </Box>
        )

      case 'apiKey':
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Configure API key</Text>
            <Text>Enter an API key, or leave it blank to use `DOGE_API_KEY`.</Text>
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
            <Text dimColor>Press Enter to continue, or Esc to go back.</Text>
          </Box>
        )

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
