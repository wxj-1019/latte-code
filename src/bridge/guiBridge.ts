import { QueryEngine } from '../QueryEngine.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { getAllBaseTools } from '../tools.js'
import { logForDebugging } from '../utils/debug.js'
import { getModelOptions } from '../utils/model/modelOptions.js'
import type { GuiServer } from '../server/guiServer.js'
import type { LocalJSXCommandContext } from '../types/command.js'
import type { SDKMessage } from '../entrypoints/sdk/controlTypes.js'
import type { PermissionDecision } from '../types/permissions.js'
import type { GuiMessageStream, GuiToolCall, GuiPermissionRequest, GuiDiffPreview, GuiDesignSystem, GuiStateSync, GuiMetadataSync, GuiSessionList, GuiError, GuiModelsSync, GuiSourcesSync, GuiPlanSync, GuiCommandsSync, GuiMessageItem } from '../gui/src/shared/protocol.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs'
import { globalEventBus, Events } from '../events/EventBus.js'

let designMdSkillModule: any = null
let generateCapabilityModule: any = null
let designModulesLoaded = false

async function loadDesignModules() {
  if (designModulesLoaded) return
  designModulesLoaded = true
  try {
    designMdSkillModule = await import('../skills/design-md-skill.js')
  } catch (e) {
    logForDebugging(`[GuiBridge] design-md-skill not available: ${e}`)
  }
  try {
    generateCapabilityModule = await import('../skills/bundled/design-md/capabilities/generate.js')
  } catch (e) {
    logForDebugging(`[GuiBridge] generate capability not available: ${e}`)
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export class GuiBridge {
  private guiServer: GuiServer
  private context: LocalJSXCommandContext
  private engine: QueryEngine | null = null
  private pendingPermissions = new Map<string, Deferred<PermissionDecision>>()
  private pendingPermissionTools = new Map<string, string>() // requestId → toolName
  private alwaysAllowedTools = new Set<string>()
  private permissionCounter = 0
  private isRunning = false
  private isRunningTimeout: ReturnType<typeof setTimeout> | null = null
  private globalMessageCounter = 0
  private sessionCost = 0
  private pendingFileOps = new Map<string, { toolName: string; filePath: string; oldContent?: string; newContent?: string }>()
  private toolUseNameMap = new Map<string, string>()
  private sessions: Array<{ id: string; name: string; status: 'active' | 'idle' | 'completed'; updatedAt: number }> = []
  private lastUserInput = ''
  private persistentDir = join(homedir(), '.latte', 'gui-sessions')
  private sources = new Set<string>()
  private currentMessages: GuiMessageItem[] = []
  private sessionMessageSnapshots = new Map<string, GuiMessageItem[]>()

  constructor(guiServer: GuiServer, context: LocalJSXCommandContext) {
    this.guiServer = guiServer
    this.context = context
  }

  async init() {
    // Load persistent session history before initializing engine
    this.loadPersistentSessions()

    const tools = getAllBaseTools()
    const fileCache = createFileStateCacheWithSizeLimit(100)

    this.engine = new QueryEngine({
      cwd: process.cwd(),
      tools,
      commands: this.context.options.commands,
      mcpClients: this.context.options.mcpClients,
      agents: this.context.options.agentDefinitions?.definitions ?? [],
      canUseTool: this.wrapCanUseTool(),
      getAppState: () => this.context.getAppState(),
      setAppState: (updater) => this.context.setAppState(updater),
      readFileCache: fileCache,
      userSpecifiedModel: this.context.options.mainLoopModel,
      verbose: this.context.options.verbose,
      thinkingConfig: this.context.options.thinkingConfig,
      includePartialMessages: true,
    })

    const sessionId = this.engine?.getSessionId() || ''
    if (sessionId && !this.sessions.some((s) => s.id === sessionId)) {
      this.sessions.push({
        id: sessionId,
        name: 'New Thread',
        status: 'active',
        updatedAt: Date.now(),
      })
      this.savePersistentSessions()
    }
    this.broadcastSessionList()
    this.broadcastMetadata()
    this.broadcastModels()
    this.broadcastCommands()
    logForDebugging('[GuiBridge] QueryEngine initialized')
  }

  async handleUserInput(content: string, attachments?: string[]) {
    if (!this.engine) {
      await this.init()
    }

    if (!this.engine) {
      this.broadcast({
        type: 'gui_error',
        payload: { message: 'Failed to initialize query engine' },
      } as GuiError)
      return
    }

    this.lastUserInput = content.trim()
    const trimmed = this.lastUserInput

    if (trimmed === '/new') {
      const activeSession = this.sessions.find((s) => s.status === 'active')
      if (activeSession) {
        activeSession.status = 'completed'
        activeSession.updatedAt = Date.now()
        this.sessionMessageSnapshots.set(activeSession.id, [...this.currentMessages])
        this.saveSessionMessages(activeSession.id, this.currentMessages)
      }
      this.savePersistentSessions()
      this.currentMessages = []
      this.engine = null
      this.pendingPermissions.clear()
      this.pendingPermissionTools.clear()
      this.alwaysAllowedTools.clear()
      this.isRunning = false
      if (this.isRunningTimeout) {
        clearTimeout(this.isRunningTimeout)
        this.isRunningTimeout = null
      }
      this.globalMessageCounter = 0
      this.sessionCost = 0
      this.toolUseNameMap.clear()
      this.sources.clear()
      this.broadcastSources()
      this.broadcast({
        type: 'gui_plan_sync',
        payload: { planItems: [] },
      } as GuiPlanSync)
      this.lastUserInput = ''
      this.broadcast({
        type: 'gui_state_sync',
        payload: {
          messages: [],
          sessionId: '',
          sessionName: 'New Thread',
          model: this.context.options.mainLoopModel,
          cost: 0,
          permissionMode: this.context.getAppState().toolPermissionContext?.mode || 'default',
          isHistoryView: false,
        },
      } as GuiStateSync)
      return
    }

    if (trimmed.startsWith('/switch ')) {
      const targetId = trimmed.slice('/switch '.length).trim()
      this.handleSessionSwitch(targetId)
      return
    }

    if (trimmed.startsWith('/model')) {
      const modelId = trimmed.slice('/model'.length).trim() || undefined
      this.context.options.mainLoopModel = modelId
      this.broadcastMetadata()
      this.broadcastModels()
      logForDebugging(`[GuiBridge] Model switched to: ${modelId || 'default'}`)
      return
    }

    if (this.isRunning) {
      this.broadcast({ type: 'gui_error', payload: { message: 'A query is already in progress' } })
      return
    }

    this.isRunning = true
    this.engine.resetAbortController()

    // Safety timeout: if isRunning stays true for more than 5 minutes,
    // force-reset it to prevent permanent lockout. This should never
    // happen in normal operation but guards against generator hangs.
    if (this.isRunningTimeout) clearTimeout(this.isRunningTimeout)
    this.isRunningTimeout = setTimeout(() => {
      if (this.isRunning) {
        logForDebugging('[GuiBridge] ⚠️ isRunning safety timeout — force resetting')
        this.isRunning = false
        this.broadcast({
          type: 'gui_error',
          payload: { message: 'Query timed out. You can try sending again.' },
        } as GuiError)
        this.broadcast({
          type: 'gui_message_stream',
          payload: {
            messageId: `assistant-${this.globalMessageCounter}`,
            role: 'assistant',
            content: '',
            done: true,
            timestamp: Date.now(),
          },
        } as GuiMessageStream)
      }
    }, 300_000)
    const userMessageId = `user-${++this.globalMessageCounter}`
    const assistantMessageId = `assistant-${++this.globalMessageCounter}`
    const userMsg: GuiMessageItem = {
      id: userMessageId,
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.currentMessages.push(userMsg)
    this.broadcast({
      type: 'gui_message_stream',
      payload: {
        messageId: userMessageId,
        role: 'user',
        content,
        done: true,
        timestamp: userMsg.timestamp,
      },
    } as GuiMessageStream)

    let currentContent = ''
    let currentThinking = ''
    const currentToolUses: { id: string; name: string; input: Record<string, unknown> }[] = []
    const currentToolResults: { toolUseId: string; content: string; isError?: boolean }[] = []
    let hasBroadcastFinal = false

    const broadcastStream = (done: boolean | undefined) => {
      this.broadcast({
        type: 'gui_message_stream',
        payload: {
          messageId: assistantMessageId,
          role: 'assistant',
          content: currentContent,
          thinking: currentThinking || undefined,
          toolUses: currentToolUses.length > 0 ? [...currentToolUses] : undefined,
          toolResults: currentToolResults.length > 0 ? [...currentToolResults] : undefined,
          done,
          timestamp: Date.now(),
        },
      } as GuiMessageStream)
    }

    try {
      const prompt: string | ContentBlockParam[] = attachments && attachments.length > 0
        ? [
            { type: 'text' as const, text: content },
            ...attachments.map((a): ContentBlockParam => {
              const match = a.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                return {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: match[1],
                    data: match[2],
                  },
                }
              }
              return { type: 'text' as const, text: a }
            }),
          ]
        : content

      const generator = this.engine.submitMessage(prompt)

      for await (const msg of generator) {
        this.handleSDKMessage(msg as SDKMessage, assistantMessageId,
          (deltaContent?: string, deltaThinking?: string, done?: boolean, isFullContent?: boolean) => {
            if (deltaContent !== undefined) {
              if (isFullContent) currentContent = deltaContent
              else currentContent += deltaContent
            }
            if (deltaThinking !== undefined) {
              if (isFullContent) currentThinking = deltaThinking
              else currentThinking += deltaThinking
            }
            if (done === true) hasBroadcastFinal = true
            broadcastStream(done)
          },
          (toolUse) => {
            if (!currentToolUses.some(u => u.id === toolUse.id)) {
              currentToolUses.push(toolUse)
            }
            this.toolUseNameMap.set(toolUse.id, toolUse.name)
            broadcastStream(undefined)
          },
          (toolResult) => {
            currentToolResults.push(toolResult)
          },
        )
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logForDebugging('[GuiBridge] Query aborted by user')
      } else {
        logForDebugging(`[GuiBridge] Query error: ${err}`)
        this.broadcast({
          type: 'gui_error',
          payload: { message: err instanceof Error ? err.message : String(err) },
        } as GuiError)
      }
    } finally {
      // Critical: clear isRunning BEFORE broadcasting done:true.
      // Otherwise the frontend can re-enable input and race with the
      // guard at the top of handleUserInput.
      this.isRunning = false
      this.pendingFileOps.clear()
      if (this.isRunningTimeout) {
        clearTimeout(this.isRunningTimeout)
        this.isRunningTimeout = null
      }

      // Ensure frontend always receives done:true to reset isGenerating,
      // even when the generator throws, is aborted, or completes without
      // ever sending a final assistant message.
      if (!hasBroadcastFinal) {
        broadcastStream(true)
      }

      // Save final assistant message to history
      const assistantMsg: GuiMessageItem = {
        id: assistantMessageId,
        role: 'assistant',
        content: currentContent,
        thinking: currentThinking || undefined,
        toolUses: currentToolUses.length > 0 ? [...currentToolUses] : undefined,
        toolResults: currentToolResults.length > 0 ? [...currentToolResults] : undefined,
        timestamp: Date.now(),
      }
      this.currentMessages.push(assistantMsg)
      const activeSession = this.sessions.find((s) => s.status === 'active')
      if (activeSession) {
        const nameFromInput = this.deriveSessionName(this.lastUserInput)
        if (nameFromInput) {
          activeSession.name = nameFromInput
          activeSession.updatedAt = Date.now()
        }
      }
      this.broadcastMetadata()
      this.broadcastSessionList()
    }
  }

  handleSessionSwitch(targetSessionId: string) {
    if (this.isRunning) {
      this.broadcast({
        type: 'gui_error',
        payload: { message: 'Cannot switch session while a query is in progress' },
      } as GuiError)
      return
    }

    const currentActive = this.sessions.find((s) => s.status === 'active')
    if (currentActive) {
      currentActive.status = 'idle'
      this.sessionMessageSnapshots.set(currentActive.id, [...this.currentMessages])
      this.saveSessionMessages(currentActive.id, this.currentMessages)
    }
    this.savePersistentSessions()

    const targetSession = this.sessions.find((s) => s.id === targetSessionId)
    if (!targetSession) {
      this.broadcast({
        type: 'gui_error',
        payload: { message: 'Session not found' },
      } as GuiError)
      return
    }

    targetSession.status = 'active'
    targetSession.updatedAt = Date.now()
    this.alwaysAllowedTools.clear()
    this.pendingPermissionTools.clear()
    this.engine = null
    this.isRunning = false
    if (this.isRunningTimeout) {
      clearTimeout(this.isRunningTimeout)
      this.isRunningTimeout = null
    }
    this.globalMessageCounter = 0
    this.sessionCost = 0
    this.toolUseNameMap.clear()
    this.sources.clear()
    const snapshot = this.sessionMessageSnapshots.get(targetSessionId) ?? []
    this.currentMessages = [...snapshot]

    this.broadcast({
      type: 'gui_state_sync',
      payload: {
        messages: snapshot,
        sessionId: targetSession.id,
        sessionName: targetSession.name,
        model: this.context.options.mainLoopModel,
        cost: 0,
        permissionMode: this.context.getAppState().toolPermissionContext?.mode || 'default',
        isHistoryView: true,
      },
    } as GuiStateSync)
    this.broadcastSessionList()
    this.broadcastMetadata()
    this.broadcastSources()
    this.broadcast({
      type: 'gui_plan_sync',
      payload: { planItems: [] },
    } as GuiPlanSync)
  }

  handlePermissionResponse(requestId: string, behavior: 'allow' | 'deny' | 'always_allow') {
    const deferred = this.pendingPermissions.get(requestId)
    if (!deferred) {
      logForDebugging(`[GuiBridge] No pending permission for ${requestId}`)
      return
    }

    if (behavior === 'allow' || behavior === 'always_allow') {
      if (behavior === 'always_allow') {
        // Remember this tool so future requests skip the prompt
        const toolName = this.pendingPermissionTools.get(requestId)
        if (toolName) {
          this.alwaysAllowedTools.add(toolName)
          logForDebugging(`[GuiBridge] Always-allow set for tool: ${toolName}`)
        }
      }
      deferred.resolve({ behavior: 'allow' })
    } else {
      deferred.resolve({ behavior: 'deny', message: 'Denied by user via GUI' })
    }

    this.pendingPermissions.delete(requestId)
    this.pendingPermissionTools.delete(requestId)
  }

  async handleDesignSystemRequest(brand: string, action: string, query?: string) {
    try {
      await loadDesignModules()

      if (!designMdSkillModule?.designMdSkill) {
        this.broadcast({
          type: 'gui_error',
          payload: { message: 'Design system skill not available' },
        } as GuiError)
        return
      }

      const result = await designMdSkillModule.designMdSkill.handler({ action: action as any, brand, query, format: 'json', theme: 'dark' })
      if (result.success && result.data) {
        let tailwindConfig: string | undefined
        if (generateCapabilityModule?.generateCapability?.generate) {
          try {
            const generated = await generateCapabilityModule.generateCapability.generate({
              brand,
              outputType: 'tailwind',
              options: {},
            })
            tailwindConfig = generated.success ? generated.code : undefined
          } catch (e) {
            logForDebugging(`[GuiBridge] Tailwind generation failed: ${e}`)
          }
        }

        const payload: GuiDesignSystem['payload'] = {
          brand,
          colors: result.data.colors ?? {},
          typography: result.data.typography ?? {},
          layout: result.data.layout ?? {},
          tailwindConfig,
          cssVariables: undefined,
        }

        this.broadcast({ type: 'gui_design_system', payload })
      } else {
        this.broadcast({
          type: 'gui_error',
          payload: { message: result.error || 'Failed to fetch design system' },
        } as GuiError)
      }
    } catch (err) {
      logForDebugging(`[GuiBridge] Design system error: ${err}`)
      this.broadcast({
        type: 'gui_error',
        payload: { message: err instanceof Error ? err.message : String(err) },
      } as GuiError)
    }
  }

  handleClientConnect() {
    // Sync metadata and lists to newly connected (or reconnected) client.
    // Note: we do NOT send gui_state_sync with messages because the client
    // retains its own message history in Zustand across reconnects.
    logForDebugging('[GuiBridge] Client connected, syncing state')
    this.broadcastMetadata()
    this.broadcastSessionList()
    this.broadcastModels()
    this.broadcastCommands()
    this.broadcastSources()
  }

  handleClientDisconnect() {
    for (const deferred of this.pendingPermissions.values()) {
      deferred.resolve({ behavior: 'deny', message: 'Client disconnected' })
    }
    this.pendingPermissions.clear()
    this.pendingPermissionTools.clear()
    this.pendingFileOps.clear()
    this.toolUseNameMap.clear()
    if (this.isRunning) {
      this.engine?.interrupt()
      this.isRunning = false
      if (this.isRunningTimeout) {
        clearTimeout(this.isRunningTimeout)
        this.isRunningTimeout = null
      }
      this.broadcast({
        type: 'gui_message_stream',
        payload: {
          messageId: `assistant-${this.globalMessageCounter}`,
          role: 'assistant',
          content: '',
          done: true,
          timestamp: Date.now(),
        },
      } as GuiMessageStream)
    }
    logForDebugging('[GuiBridge] All clients disconnected, cleaned up pending state')
  }

  handleInterrupt() {
    this.engine?.interrupt()
    this.isRunning = false
    if (this.isRunningTimeout) {
      clearTimeout(this.isRunningTimeout)
      this.isRunningTimeout = null
    }
    this.pendingFileOps.clear()
    this.toolUseNameMap.clear()
    for (const [requestId, deferred] of this.pendingPermissions) {
      deferred.resolve({ behavior: 'deny', message: 'Query interrupted' })
    }
    this.pendingPermissions.clear()
    this.pendingPermissionTools.clear()
    this.broadcast({
      type: 'gui_error',
      payload: { message: 'Query interrupted by user' },
    } as GuiError)
    this.broadcast({
      type: 'gui_message_stream',
      payload: {
        messageId: `assistant-${this.globalMessageCounter}`,
        role: 'assistant',
        content: '',
        done: true,
        timestamp: Date.now(),
      },
    } as GuiMessageStream)
  }

  private wrapCanUseTool() {
    const original = this.context.canUseTool
    return async (tool: any, input: any, toolUseContext: any, assistantMessage: any, toolUseID: string, forceDecision?: any) => {
      if (forceDecision) return forceDecision
      if (!original) return { behavior: 'allow' } as PermissionDecision

      const result = await original(tool, input, toolUseContext, assistantMessage, toolUseID)
      if (result.behavior !== 'ask') return result

      const toolName = tool.name || String(tool)

      // Skip prompt if user already chose "always allow" for this tool
      if (this.alwaysAllowedTools.has(toolName)) {
        return { behavior: 'allow' } as PermissionDecision
      }

      // Need to ask user via GUI
      this.permissionCounter++
      const requestId = `perm-${this.permissionCounter}`
      const deferred = createDeferred<PermissionDecision>()
      this.pendingPermissions.set(requestId, deferred)
      this.pendingPermissionTools.set(requestId, toolName)

      this.broadcast({
        type: 'gui_permission_request',
        payload: {
          requestId,
          toolName,
          input,
          description: `${toolName}: ${JSON.stringify(input).slice(0, 200)}`,
        },
      } as GuiPermissionRequest)

      return deferred.promise
    }
  }

  private handleSDKMessage(
    msg: SDKMessage,
    assistantMessageId: string,
    onUpdate: (content?: string, thinking?: string, done?: boolean, isFullContent?: boolean) => void,
    onToolUse?: (toolUse: { id: string; name: string; input: Record<string, unknown> }) => void,
    onToolResult?: (toolResult: { toolUseId: string; content: string; isError?: boolean }) => void,
  ) {
    if (msg.type === 'user' || msg.type === 'assistant') {
      logForDebugging(`[GuiBridge] 🔍 handleSDKMessage type=${msg.type} content_type=${typeof (msg as any).message?.content} isArray=${Array.isArray((msg as any).message?.content)} blocks=${Array.isArray((msg as any).message?.content) ? (msg as any).message?.content?.map((b: any) => b?.type).join(',') : 'N/A'}`)
    }
    switch (msg.type) {
      case 'assistant': {
        const content = msg.message?.content
        if (Array.isArray(content)) {
          let text = ''
          let thinking = ''
          for (const block of content) {
            if (typeof block !== 'object' || !block) continue
            if (block.type === 'text') { text += block.text || '' }
            if (block.type === 'thinking') { thinking += block.thinking || '' }
            if (block.type === 'tool_use') {
              const toolName = block.name || 'unknown'
              logForDebugging(`[GuiBridge] 🔧 tool_use: name=${toolName} id=${block.id}`)
              onToolUse?.({ id: block.id || '', name: toolName, input: block.input || {} })
              this.broadcast({
                type: 'gui_tool_call',
                payload: {
                  toolUseId: block.id || '',
                  toolName: block.name || 'unknown',
                  input: block.input || {},
                  status: 'running',
                },
              } as GuiToolCall)
              if (block.name === 'FileEditTool' || block.name === 'Edit' || block.name === 'SearchReplace') {
                const inp = block.input || {}
                const opId = block.id || ''
                const filePath = inp.file_path || inp.path || ''
                const oldContent = inp.old_string || inp.old_str || ''
                const newContent = inp.new_string || inp.new_str || ''
                this.pendingFileOps.set(opId, {
                  toolName: block.name,
                  filePath,
                  oldContent,
                  newContent,
                })
                if (filePath) {
                  this.broadcast({
                    type: 'gui_diff_preview',
                    payload: {
                      filePath,
                      oldContent,
                      newContent,
                      toolName: block.name,
                      accepted: undefined,
                    },
                  } as GuiDiffPreview)
                }
                logForDebugging(`[GuiBridge] 📝 Registered pendingFileOp + broadcast diff: tool=${block.name} id=${opId} file=${filePath}`)
              } else if (block.name === 'FileWriteTool' || block.name === 'Write') {
                const inp = block.input || {}
                const filePath = inp.file_path || inp.path || ''
                const newContent = inp.content || ''
                this.pendingFileOps.set(block.id || '', {
                  toolName: block.name,
                  filePath,
                  newContent,
                })
                if (filePath) {
                  this.broadcast({
                    type: 'gui_diff_preview',
                    payload: {
                      filePath,
                      newContent,
                      toolName: block.name,
                      accepted: undefined,
                    },
                  } as GuiDiffPreview)
                }
              } else if (block.name === 'FileReadTool' || block.name === 'Read') {
                const inp = block.input || {}
                const filePath = inp.file_path || inp.path || ''
                if (filePath && !this.sources.has(filePath)) {
                  this.sources.add(filePath)
                  this.broadcastSources()
                }
              } else if (block.name === 'TodoWrite') {
                const inp = block.input || {}
                const todos = inp.todos || []
                if (Array.isArray(todos)) {
                  this.broadcast({
                    type: 'gui_plan_sync',
                    payload: {
                      planItems: todos.map((t: any, idx: number) => ({
                        id: `plan-${idx}`,
                        text: t.content || t.activeForm || '',
                        status: t.status === 'completed' ? 'done' : t.status,
                      })),
                    },
                  } as GuiPlanSync)
                }
              }
            }
          }
          if (text || thinking) {
            // Pass isFullContent=true so the callback replaces rather than
            // appends. assistant_partial deltas have already been streamed
            // incrementally; the final assistant message carries the full
            // text/thinking blocks and must not double-count them.
            onUpdate(text || undefined, thinking || undefined, undefined, true)
          }
        }
        break
      }

      case 'assistant_partial': {
        const delta = (msg as any).delta
        if (!delta) break
        if (typeof delta === 'string') {
          onUpdate(delta, undefined, false)
        } else if (typeof delta === 'object' && delta) {
          if (delta.type === 'thinking_delta' || delta.thinking) {
            onUpdate(undefined, delta.thinking || delta.text || '', false)
          } else if (delta.text) {
            onUpdate(delta.text, undefined, false)
          }
        }
        break
      }

      case 'stream_event': {
        const event = (msg as any).event
        if (!event) break
        if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta?.type === 'text_delta' && delta.text) {
            onUpdate(delta.text, undefined, false)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            onUpdate(undefined, delta.thinking, false)
          }
        } else if (event.type === 'content_block_stop') {
          // Content block finished — no action needed, text already accumulated in caller
        }
        break
      }

      case 'tool_progress': {
        const data = (msg as any).data || {}
        this.broadcast({
          type: 'gui_tool_call',
          payload: {
            toolUseId: data.tool_use_id || undefined,
            toolName: data.tool_name || 'unknown',
            input: {},
            status: 'running',
            output: data.output,
            durationMs: data.elapsed_time_seconds ? data.elapsed_time_seconds * 1000 : undefined,
          },
        } as GuiToolCall)
        break
      }

      case 'result': {
        const result = msg as any
        if (typeof result.total_cost_usd === 'number') {
          this.sessionCost = result.total_cost_usd
        }
        if (result.permission_denials?.length > 0) {
          for (const denial of result.permission_denials) {
            this.broadcast({
              type: 'gui_error',
              payload: { message: `Permission denied: ${denial.tool_name}` },
            } as GuiError)
          }
        }
        // Do NOT broadcast done:true here. The finally-block in
        // handleUserInput is the single authoritative source for
        // signaling query completion. Sending done:true here while
        // isRunning is still true causes a race where the frontend
        // re-enables the input before the backend is truly idle.
        this.broadcastMetadata()
        break
      }

      case 'user': {
        const content = msg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block && block.type === 'tool_result') {
              const toolResult = block.content
              let output = ''
              if (typeof toolResult === 'string') {
                output = toolResult
              } else if (Array.isArray(toolResult)) {
                output = toolResult.map((c: any) => c.text || '').join('')
              }
              const toolUseId = block.tool_use_id || ''
              onToolResult?.({ toolUseId, content: output, isError: block.is_error })
              const toolName = this.toolUseNameMap.get(toolUseId) || 'result'
              logForDebugging(`[GuiBridge] 📦 Tool result: toolUseId=${toolUseId} toolName=${toolName} isError=${block.is_error} pendingFileOps.has=${this.pendingFileOps.has(toolUseId)}`)
              this.broadcast({
                type: 'gui_tool_call',
                payload: {
                  toolUseId,
                  toolName,
                  input: { tool_use_id: block.tool_use_id },
                  status: block.is_error ? 'error' : 'success',
                  output: output.slice(0, 5000),
                },
              } as GuiToolCall)

              if (!block.is_error && this.pendingFileOps.has(toolUseId)) {
                const op = this.pendingFileOps.get(toolUseId)!
                this.pendingFileOps.delete(toolUseId)
                this.broadcast({
                  type: 'gui_diff_preview',
                  payload: {
                    filePath: op.filePath,
                    oldContent: op.oldContent,
                    newContent: op.newContent || '',
                    toolName: op.toolName,
                    accepted: true,
                  },
                } as GuiDiffPreview)
              } else if (block.is_error && this.pendingFileOps.has(toolUseId)) {
                const op = this.pendingFileOps.get(toolUseId)!
                this.pendingFileOps.delete(toolUseId)
                this.broadcast({
                  type: 'gui_diff_preview',
                  payload: {
                    filePath: op.filePath,
                    oldContent: op.oldContent,
                    newContent: op.newContent || '',
                    toolName: op.toolName,
                    accepted: false,
                  },
                } as GuiDiffPreview)
              }
            }
          }
        }
        break
      }

      case 'system': {
        const subtype = (msg as any).subtype
        if (subtype === 'api_error') {
          this.broadcast({
            type: 'gui_error',
            payload: { message: (msg as any).error || 'API error' },
          } as GuiError)
        }
        break
      }
    }
  }

  private broadcastMetadata() {
    this.broadcast({
      type: 'gui_metadata_sync',
      payload: {
        sessionId: this.engine?.getSessionId() || '',
        sessionName: this.sessions.find((s) => s.status === 'active')?.name || 'New Thread',
        model: this.context.options.mainLoopModel,
        cost: this.sessionCost,
        permissionMode: this.context.getAppState().toolPermissionContext?.mode || 'default',
      },
    } as GuiMetadataSync)
  }

  private broadcastSessionList() {
    this.broadcast({
      type: 'gui_session_list',
      payload: {
        sessions: this.sessions.map((s) => ({ ...s })),
      },
    } as GuiSessionList)
  }

  private broadcastModels() {
    try {
      const options = getModelOptions()
      this.broadcast({
        type: 'gui_models_sync',
        payload: {
          models: options.map((o) => ({
            id: o.value ?? 'default',
            name: o.label,
            description: o.description,
          })),
        },
      } as GuiModelsSync)
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to broadcast models: ${e}`)
    }
  }

  private broadcastCommands() {
    try {
      const all = this.context.options.commands || []
      const cmds = all
        .filter((cmd) => cmd.userInvocable !== false && !cmd.isHidden)
        .map((cmd) => ({
          name: cmd.name,
          description: cmd.description || '',
          descriptionZh: cmd.descriptionZh,
          aliases: cmd.aliases,
          argumentHint: cmd.argumentHint,
        }))
      logForDebugging(`[GuiBridge] Broadcasting ${cmds.length} commands (total: ${all.length})`)
      this.broadcast({
        type: 'gui_commands_sync',
        payload: { commands: cmds },
      } as GuiCommandsSync)
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to broadcast commands: ${e}`)
    }
  }

  private broadcastSources() {
    const fileNodes = Array.from(this.sources).map((path) => {
      // Handle both Unix '/' and Windows '\\' separators
      const parts = path.split(/[/\\]/)
      const name = parts[parts.length - 1] || path
      return { name, path, type: 'file' as const }
    })
    this.broadcast({
      type: 'gui_sources_sync',
      payload: { sources: fileNodes },
    } as GuiSourcesSync)
  }

  private broadcast(msg: unknown) {
    this.guiServer.broadcast(msg)
  }

  private deriveSessionName(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    const SLASH_COMMANDS = ['/model', '/new', '/switch', '/clear', '/compact', '/cost', '/help', '/theme', '/retry', '/undo']
    if (SLASH_COMMANDS.some((cmd) => trimmed.startsWith(cmd + ' ') || trimmed === cmd)) return null
    const firstLine = trimmed.split('\n')[0]
    return firstLine.length > 50 ? firstLine.slice(0, 47) + '...' : firstLine
  }

  /* ── Session Persistence ── */

  private ensurePersistentDir() {
    try {
      mkdirSync(this.persistentDir, { recursive: true })
    } catch { /* ignore */ }
  }

  private getIndexPath() {
    return join(this.persistentDir, 'index.json')
  }

  private getSessionPath(sessionId: string) {
    return join(this.persistentDir, `${sessionId}.json`)
  }

  private loadPersistentSessions() {
    this.ensurePersistentDir()
    const indexPath = this.getIndexPath()
    if (!existsSync(indexPath)) return
    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8')) as Array<{
        id: string
        name: string
        status: 'active' | 'idle' | 'completed'
        updatedAt: number
      }>
      for (const s of data) {
        if (s.status === 'active') s.status = 'idle'
        if (!this.sessions.some((existing) => existing.id === s.id)) {
          this.sessions.push(s)
        }
        const sessionPath = this.getSessionPath(s.id)
        if (existsSync(sessionPath)) {
          const messages = JSON.parse(readFileSync(sessionPath, 'utf-8')) as GuiMessageItem[]
          this.sessionMessageSnapshots.set(s.id, messages)
        }
      }
      logForDebugging(`[GuiBridge] Loaded ${data.length} persistent sessions`)
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to load persistent sessions: ${e}`)
    }
  }

  private savePersistentSessions() {
    this.ensurePersistentDir()
    try {
      const data = this.sessions.map((s) => ({ ...s }))
      writeFileSync(this.getIndexPath(), JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to save persistent sessions: ${e}`)
    }
  }

  private saveSessionMessages(sessionId: string, messages: GuiMessageItem[]) {
    this.ensurePersistentDir()
    try {
      writeFileSync(
        this.getSessionPath(sessionId),
        JSON.stringify(messages, null, 2),
        'utf-8',
      )
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to save session messages: ${e}`)
    }
  }

  private deletePersistentSession(sessionId: string) {
    try {
      const sessionPath = this.getSessionPath(sessionId)
      if (existsSync(sessionPath)) {
        unlinkSync(sessionPath)
      }
    } catch (e) {
      logForDebugging(`[GuiBridge] Failed to delete persistent session: ${e}`)
    }
  }

  private cleanupOrphanedSessionFiles() {
    try {
      const files = readdirSync(this.persistentDir)
      const validIds = new Set(this.sessions.map((s) => s.id))
      for (const file of files) {
        if (file === 'index.json') continue
        const sessionId = file.replace(/\.json$/, '')
        if (!validIds.has(sessionId)) {
          unlinkSync(join(this.persistentDir, file))
        }
      }
    } catch { /* ignore */ }
  }

  handleSessionDelete(sessionId: string) {
    const idx = this.sessions.findIndex((s) => s.id === sessionId)
    if (idx < 0) return

    const session = this.sessions[idx]
    if (session.status === 'active') {
      this.broadcast({
        type: 'gui_error',
        payload: { message: 'Cannot delete the active session' },
      } as GuiError)
      return
    }

    this.sessions.splice(idx, 1)
    this.sessionMessageSnapshots.delete(sessionId)
    this.deletePersistentSession(sessionId)
    this.savePersistentSessions()
    this.cleanupOrphanedSessionFiles()
    this.broadcastSessionList()
  }

  handleSessionRename(sessionId: string, name: string) {
    const session = this.sessions.find((s) => s.id === sessionId)
    if (!session || !name.trim()) return
    session.name = name.trim()
    session.updatedAt = Date.now()
    this.savePersistentSessions()
    this.broadcastSessionList()
    if (session.status === 'active') {
      this.broadcastMetadata()
    }
  }
}
