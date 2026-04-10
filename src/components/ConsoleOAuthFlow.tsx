import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { installOAuthTokens } from '../cli/handlers/auth.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { setClipboard } from '../ink/termio/osc.js'
import { useTerminalNotification } from '../ink/useTerminalNotification.js'
import { Box, Link, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { getSSLErrorHint } from '../services/api/errorUtils.js'
import { runCodexOAuthFlow } from '../services/oauth/codex-client.js'
import { OAuthService } from '../services/oauth/index.js'
import { sendNotification } from '../services/notifier.js'
import { useSetAppState } from '../state/AppState.js'
import {
  saveCodexOAuthTokens,
  validateForceLoginOrg,
} from '../utils/auth.js'
import { logError } from '../utils/log.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import type { SaveCustomModelResult } from '../utils/customApiStorage.js'
import { CustomModelSetupFlow } from './CustomModelSetupFlow.js'
import { Select } from './CustomSelect/select.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
  onCustomApiSetup?: () => void
  startInOAuthSelector?: boolean
}

type OAuthStatus =
  | { state: 'idle' }
  | { state: 'platform_setup' }
  | { state: 'custom_api_setup' }
  | { state: 'ready_to_start' }
  | { state: 'waiting_for_login'; url: string }
  | { state: 'success'; token?: string }
  | { state: 'about_to_retry'; nextState: OAuthStatus }
  | { state: 'error'; message: string; toRetry?: OAuthStatus }

type CompletionKind = 'auth' | 'custom'

const PASTE_HERE_MSG = 'Paste code here if prompted > '

export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
  onCustomApiSetup,
  startInOAuthSelector = false,
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {}
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod
  const orgUUID = settings.forceLoginOrgUUID
  const forcedMethodMessage =
    forceLoginMethod === 'claudeai'
      ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)'
      : forceLoginMethod === 'console'
        ? 'Login method pre-selected: API Usage Billing (Anthropic Console)'
        : null

  const terminal = useTerminalNotification()
  const setAppState = useSetAppState()
  const [oauthService] = useState(() => new OAuthService())
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (
      mode === 'setup-token' ||
      forceLoginMethod === 'claudeai' ||
      forceLoginMethod === 'console'
    ) {
      return { state: 'ready_to_start' }
    }
    return { state: startInOAuthSelector ? 'idle' : 'custom_api_setup' }
  })
  const [completionKind, setCompletionKind] =
    useState<CompletionKind>('auth')
  const [pastedCode, setPastedCode] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(
    () => mode === 'setup-token' || forceLoginMethod === 'claudeai',
  )
  const [loginWithCodex, setLoginWithCodex] = useState(false)
  const [showPastePrompt, setShowPastePrompt] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const textInputColumns = Math.max(
    20,
    useTerminalSize().columns - PASTE_HERE_MSG.length - 1,
  )
  const pendingOAuthStartRef = useRef(false)

  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {})
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {})
    }
  }, [forceLoginMethod])

  useEffect(() => {
    if (oauthStatus.state !== 'waiting_for_login') {
      setShowPastePrompt(false)
      setUrlCopied(false)
    }
  }, [oauthStatus.state])

  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState)
      return () => clearTimeout(timer)
    }
  }, [oauthStatus])

  useKeybinding(
    'confirm:yes',
    () => {
      logEvent('tengu_oauth_success', {
        loginWithClaudeAi,
      })
      onDone()
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'success' && mode !== 'setup-token',
    },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      setOAuthStatus({ state: 'idle' })
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'platform_setup',
    },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
        setPastedCode('')
        setOAuthStatus({
          state: 'about_to_retry',
          nextState: oauthStatus.toRetry,
        })
      }
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry,
    },
  )

  useEffect(() => {
    if (
      pastedCode === 'c' &&
      oauthStatus.state === 'waiting_for_login' &&
      showPastePrompt &&
      !urlCopied
    ) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) {
          process.stdout.write(raw)
        }
        setUrlCopied(true)
        setTimeout(setUrlCopied, 2000, false)
      })
      setPastedCode('')
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied])

  const openLegacyMethod = useCallback(
    (
      method:
        | 'custom_api'
        | 'claudeai'
        | 'console'
        | 'platform'
        | 'codex',
    ) => {
      setCompletionKind('auth')

      if (method === 'custom_api') {
        logEvent('tengu_oauth_custom_api_selected', {})
        if (onCustomApiSetup) {
          onCustomApiSetup()
          return
        }
        setOAuthStatus({ state: 'custom_api_setup' })
        return
      }

      if (method === 'platform') {
        logEvent('tengu_oauth_platform_selected', {})
        setOAuthStatus({ state: 'platform_setup' })
        return
      }

      if (method === 'codex') {
        logEvent('tengu_oauth_codex_selected', {})
        setLoginWithCodex(true)
        setLoginWithClaudeAi(false)
        setOAuthStatus({ state: 'ready_to_start' })
        return
      }

      setLoginWithCodex(false)
      setLoginWithClaudeAi(method === 'claudeai')
      setOAuthStatus({ state: 'ready_to_start' })

      if (method === 'claudeai') {
        logEvent('tengu_oauth_claudeai_selected', {})
      } else {
        logEvent('tengu_oauth_console_selected', {})
      }
    },
    [onCustomApiSetup],
  )

  async function handleSubmitCode(value: string, url: string) {
    try {
      const [authorizationCode, state] = value.split('#')
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied.',
          toRetry: { state: 'waiting_for_login', url },
        })
        return
      }

      logEvent('tengu_oauth_manual_entry', {})
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state,
      })
    } catch (err: unknown) {
      logError(err)
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: { state: 'waiting_for_login', url },
      })
    }
  }

  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', {
        loginWithClaudeAi,
      })

      const result = await oauthService
        .startOAuthFlow(
          async url => {
            setOAuthStatus({ state: 'waiting_for_login', url })
            setTimeout(setShowPastePrompt, 3000, true)
          },
          {
            loginWithClaudeAi,
            inferenceOnly: mode === 'setup-token',
            expiresIn:
              mode === 'setup-token'
                ? 365 * 24 * 60 * 60
                : undefined,
            orgUUID,
          },
        )
        .catch(err => {
          const isTokenExchangeError = err.message.includes(
            'Token exchange failed',
          )
          const sslHint = getSSLErrorHint(err)
          setOAuthStatus({
            state: 'error',
            message:
              sslHint ??
              (isTokenExchangeError
                ? 'Failed to exchange authorization code for access token. Please try again.'
                : err.message),
            toRetry:
              mode === 'setup-token'
                ? { state: 'ready_to_start' }
                : { state: 'idle' },
          })
          logEvent('tengu_oauth_token_exchange_error', {
            error: err.message,
            ssl_error: sslHint !== null,
          })
          throw err
        })

      setCompletionKind('auth')

      if (mode === 'setup-token') {
        setOAuthStatus({
          state: 'success',
          token: result.accessToken,
        })
        return
      }

      await installOAuthTokens(result)
      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        throw new Error(
          'message' in orgResult ? orgResult.message : 'Invalid organization',
        )
      }

      setOAuthStatus({ state: 'success' })
      void sendNotification(
        {
          message: 'Claude Code login successful',
          notificationType: 'auth_success',
        },
        terminal,
      )
    } catch (err) {
      const errorMessage = (err as Error).message
      const sslHint = getSSLErrorHint(err)
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry:
          mode === 'setup-token'
            ? { state: 'ready_to_start' }
            : { state: 'idle' },
      })
      logEvent('tengu_oauth_error', {
        error:
          errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null,
      })
    }
  }, [loginWithClaudeAi, mode, oauthService, orgUUID, terminal])

  const startCodexOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_codex_flow_start', {})
      const codexTokens = await runCodexOAuthFlow(async url => {
        setOAuthStatus({ state: 'waiting_for_login', url })
        setTimeout(setShowPastePrompt, 3000, true)
      })

      saveCodexOAuthTokens(codexTokens)
      setCompletionKind('auth')
      setOAuthStatus({ state: 'success' })
      logEvent('tengu_oauth_codex_success', {})
      void sendNotification(
        {
          message: 'Codex login successful',
          notificationType: 'auth_success',
        },
        terminal,
      )
    } catch (err) {
      const message = (err as Error).message
      logEvent('tengu_oauth_codex_error', {
        error:
          message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      setOAuthStatus({
        state: 'error',
        message,
        toRetry: { state: 'idle' },
      })
    }
  }, [terminal])

  useEffect(() => {
    if (
      oauthStatus.state === 'ready_to_start' &&
      !pendingOAuthStartRef.current
    ) {
      pendingOAuthStartRef.current = true
      const start = loginWithCodex ? startCodexOAuth : startOAuth
      process.nextTick(() => {
        void start()
        pendingOAuthStartRef.current = false
      })
    }
  }, [loginWithCodex, oauthStatus.state, startCodexOAuth, startOAuth])

  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      const timer = setTimeout(() => {
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi,
        })
        onDone()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [loginWithClaudeAi, mode, oauthStatus, onDone])

  useEffect(() => {
    return () => {
      oauthService.cleanup()
    }
  }, [oauthService])

  const handleCustomModelSuccess = useCallback(
    (result: SaveCustomModelResult) => {
      const savedModel = result.model
      if (savedModel) {
        setAppState(prev => ({
          ...prev,
          mainLoopModel: savedModel.model,
          mainLoopModelForSession: null,
        }))
      }

      logEvent('tengu_oauth_custom_api_configured', {})
      setCompletionKind('custom')
      setOAuthStatus({ state: 'success' })
    },
    [setAppState],
  )

  return (
    <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt ? (
        <Box flexDirection="column" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the URL below to sign in{' '}
            </Text>
            {urlCopied ? (
              <Text color="success">(Copied!)</Text>
            ) : (
              <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>
            )}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>
      ) : null}

      {mode === 'setup-token' &&
      oauthStatus.state === 'success' &&
      oauthStatus.token ? (
        <Box flexDirection="column" gap={1} paddingTop={1}>
          <Text color="success">
            Long-lived authentication token created successfully.
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text>Your OAuth token (valid for 1 year):</Text>
            <Text color="warning">{oauthStatus.token}</Text>
            <Text dimColor>
              Store this token securely. You won&apos;t be able to see it again.
            </Text>
            <Text dimColor>
              Use this token by setting:
              {' '}
              <Text bold>CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;</Text>
            </Text>
          </Box>
        </Box>
      ) : null}

      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage
          oauthStatus={oauthStatus}
          completionKind={completionKind}
          mode={mode}
          startingMessage={startingMessage}
          forcedMethodMessage={forcedMethodMessage}
          showPastePrompt={showPastePrompt}
          pastedCode={pastedCode}
          setPastedCode={setPastedCode}
          cursorOffset={cursorOffset}
          setCursorOffset={setCursorOffset}
          textInputColumns={textInputColumns}
          handleSubmitCode={handleSubmitCode}
          openLegacyMethod={openLegacyMethod}
          onCustomModelSuccess={handleCustomModelSuccess}
          setOAuthStatus={setOAuthStatus}
        />
      </Box>
    </Box>
  )
}

type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus
  completionKind: CompletionKind
  mode: 'login' | 'setup-token'
  startingMessage?: string
  forcedMethodMessage: string | null
  showPastePrompt: boolean
  pastedCode: string
  setPastedCode(value: string): void
  cursorOffset: number
  setCursorOffset(offset: number): void
  textInputColumns: number
  handleSubmitCode(value: string, url: string): void
  openLegacyMethod(
    method: 'custom_api' | 'claudeai' | 'console' | 'platform' | 'codex',
  ): void
  onCustomModelSuccess(result: SaveCustomModelResult): void
  setOAuthStatus(status: OAuthStatus): void
}

function OAuthStatusMessage({
  oauthStatus,
  completionKind,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  openLegacyMethod,
  onCustomModelSuccess,
  setOAuthStatus,
}: OAuthStatusMessageProps): React.ReactNode {
  switch (oauthStatus.state) {
    case 'idle':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>
            {startingMessage ??
              'Configure a custom API endpoint to use Latte Code, or choose another sign-in method.'}
          </Text>
          {forcedMethodMessage ? <Text dimColor>{forcedMethodMessage}</Text> : null}
          <Text>Choose how you want to connect:</Text>
          <Box>
            <Select
              options={[
                {
                  label: 'Custom API endpoint',
                  value: 'custom_api',
                  description:
                    'OpenAI-compatible endpoint configuration. Recommended.',
                },
                {
                  label: 'Claude account with subscription',
                  value: 'claudeai',
                  description: 'Claude Pro, Max, Team, or Enterprise.',
                },
                {
                  label: 'Anthropic Console account',
                  value: 'console',
                  description: 'API usage billing through Anthropic Console.',
                },
                {
                  label: '3rd-party platform',
                  value: 'platform',
                  description: 'Amazon Bedrock, Microsoft Foundry, or Vertex AI.',
                },
                {
                  label: 'OpenAI Codex account',
                  value: 'codex',
                  description: 'ChatGPT Plus or Pro subscription.',
                },
              ]}
              onChange={value =>
                openLegacyMethod(
                  value as
                    | 'custom_api'
                    | 'claudeai'
                    | 'console'
                    | 'platform'
                    | 'codex',
                )
              }
            />
          </Box>
        </Box>
      )

    case 'platform_setup':
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>3rd-party platform setup</Text>
          <Text>
            Platform-based authentication is still available, but it is no
            longer the default setup path.
          </Text>
          <Text dimColor>Press Enter to return and choose another option.</Text>
        </Box>
      )

    case 'custom_api_setup':
      return (
        <CustomModelSetupFlow
          onDone={() => {}}
          onSuccess={onCustomModelSuccess}
          onCancel={() => setOAuthStatus({ state: 'idle' })}
          completeOnCancel={false}
        />
      )

    case 'ready_to_start':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Opening browser for sign in...</Text>
          </Box>
          {forcedMethodMessage ? <Text dimColor>{forcedMethodMessage}</Text> : null}
        </Box>
      )

    case 'waiting_for_login':
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Waiting for sign in...</Text>
          <Text>
            Complete the browser flow, then paste the authorization code here.
          </Text>
          <Box>
            <Text>{PASTE_HERE_MSG}</Text>
            <TextInput
              value={pastedCode}
              onChange={setPastedCode}
              onSubmit={value => handleSubmitCode(value, oauthStatus.url)}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              columns={textInputColumns}
              focus
            />
          </Box>
          <Text dimColor>
            {showPastePrompt
              ? 'Press Enter to submit, or press c to copy the sign-in URL.'
              : 'Press Enter to submit after copying the full code from your browser.'}
          </Text>
        </Box>
      )

    case 'success':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="success">
            {completionKind === 'custom'
              ? 'Custom API endpoint configured successfully.'
              : mode === 'setup-token'
                ? 'OAuth token ready.'
                : 'Login successful.'}
          </Text>
          <Text dimColor>
            {mode === 'setup-token'
              ? 'Closing automatically...'
              : 'Press Enter to continue.'}
          </Text>
        </Box>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">Setup failed.</Text>
          <Text>{oauthStatus.message}</Text>
          {oauthStatus.toRetry ? (
            <Text dimColor>Press Enter to try again.</Text>
          ) : (
            <Text dimColor>Press Esc to cancel.</Text>
          )}
        </Box>
      )

    default:
      return null
  }
}
