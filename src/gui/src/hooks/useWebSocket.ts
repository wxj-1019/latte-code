import { useEffect, useCallback } from 'react'
import { useGuiStore } from '../store/guiStore.ts'
import { useToastStore } from '../store/toastStore.ts'
import type { ServerMessage, ClientMessage, GuiMessageItem } from '../shared/protocol.ts'

const WS_URL = `ws://${window.location.host}/ws`

// ── Module-level singleton connection ──
let singletonWs: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let refCount = 0
let messageQueue: ClientMessage[] = []
let reconnectDelay = 2000
let generationTimeout: ReturnType<typeof setTimeout> | null = null

const getState = useGuiStore.getState

const GENERATION_TIMEOUT_MS = 120_000 // 2 minutes safety net

function startGenerationTimeout() {
  if (generationTimeout) clearTimeout(generationTimeout)
  generationTimeout = setTimeout(() => {
    const store = getState()
    if (store.isGenerating) {
      store.setGenerating(false)
      useToastStore.getState().addToast({
        type: 'warning',
        message: 'Response seems to have stalled. You can try sending again.',
        duration: 5000,
      })
    }
  }, GENERATION_TIMEOUT_MS)
}

function clearGenerationTimeout() {
  if (generationTimeout) {
    clearTimeout(generationTimeout)
    generationTimeout = null
  }
}

function handleServerMessage(msg: ServerMessage) {
  const store = getState()

  switch (msg.type) {
    case 'gui_connected':
      store.setConnected(true)
      break

    case 'gui_disconnected':
      store.setConnected(false)
      store.setGenerating(false)
      clearGenerationTimeout()
      break

    case 'gui_state_sync': {
      const p = msg.payload
      store.setSessionInfo({
        sessionId: p.sessionId,
        sessionName: p.sessionName,
        model: p.model,
        branch: p.branch,
        cost: p.cost,
        permissionMode: p.permissionMode,
        isHistoryView: p.isHistoryView,
      })
      store.setMessages(p.messages)
      store.clearTransient()
      break
    }

    case 'gui_message_stream': {
      const p = msg.payload
      if (p.done === true) {
        store.setGenerating(false)
        store.clearToolCalls()
        clearGenerationTimeout()
      } else {
        if (!store.isGenerating) store.setGenerating(true)
        startGenerationTimeout()
      }
      const existing = store.messages.find((m) => m.id === p.messageId)
      if (existing) {
        store.updateMessage(p.messageId, {
          content: p.content ?? existing.content,
          thinking: p.thinking !== undefined ? p.thinking : existing.thinking,
          toolUses: p.toolUses ?? existing.toolUses,
          toolResults: p.toolResults ?? existing.toolResults,
        })
      } else {
        const item: GuiMessageItem = {
          id: p.messageId,
          role: p.role,
          content: p.content ?? '',
          thinking: p.thinking,
          toolUses: p.toolUses,
          toolResults: p.toolResults,
          timestamp: p.timestamp,
        }
        store.addMessage(item)
      }
      break
    }

    case 'gui_tool_call': {
      const p = msg.payload
      // Prefer exact toolUseId match; fall back to (toolName + input signature)
      // to disambiguate multiple running tools of the same type.
      const existing = store.toolCalls.find((tc) => {
        if (p.toolUseId && tc.toolUseId === p.toolUseId) return true
        if (!p.toolUseId) {
          const inputMatch =
            JSON.stringify(tc.input ?? {}) === JSON.stringify(p.input ?? {})
          return tc.toolName === p.toolName && tc.status === 'running' && inputMatch
        }
        return false
      })
      if (existing) {
        store.updateToolCall(
          { toolUseId: p.toolUseId, toolName: p.toolName, input: p.input },
          {
            status: p.status,
            output: p.output,
            durationMs: p.durationMs,
          },
        )
      } else {
        store.addToolCall(p)
      }
      break
    }

    case 'gui_permission_request':
      store.addPermission(msg.payload)
      break

    case 'gui_diff_preview':
      store.addDiff(msg.payload)
      break

    case 'gui_design_system':
      store.setDesignSystem(msg.payload)
      break

    case 'gui_metadata_sync':
      store.setSessionInfo(msg.payload)
      break

    case 'gui_session_list':
      store.setSessions(msg.payload.sessions)
      break

    case 'gui_error':
      // Do NOT reset isGenerating here — only gui_message_stream with
      // done:true (or gui_query_done) should control that state.
      // Non-terminal errors (e.g. permission denied for one tool) arrive
      // mid-query while the backend is still running. Resetting
      // isGenerating here lets the user re-send prematurely, hitting
      // "A query is already in progress" on the backend.
      clearGenerationTimeout()
      useToastStore.getState().addToast({ type: 'error', message: msg.payload.message })
      break

    case 'pong':
      // Heartbeat response — no action needed
      break

    case 'gui_models_sync':
      store.setAvailableModels(msg.payload.models)
      break

    case 'gui_commands_sync':
      store.setCommands(msg.payload.commands)
      break

    case 'gui_sources_sync':
      store.setSources(msg.payload.sources)
      break

    case 'gui_plan_sync':
      store.setPlanItems(msg.payload.planItems)
      break
  }
}

function connect() {
  if (singletonWs && (singletonWs.readyState === WebSocket.OPEN || singletonWs.readyState === WebSocket.CONNECTING)) return

  const ws = new WebSocket(WS_URL)
  singletonWs = ws

  ws.onopen = () => {
    getState().setConnected(true)
    reconnectDelay = 2000 // Reset backoff on successful connection
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    // Start heartbeat
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (singletonWs?.readyState === WebSocket.OPEN) {
        singletonWs.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
    // Flush queued messages that were sent while disconnected
    while (messageQueue.length > 0 && singletonWs?.readyState === WebSocket.OPEN) {
      const msg = messageQueue.shift()!
      singletonWs.send(JSON.stringify(msg))
    }
  }

  ws.onclose = () => {
    getState().setConnected(false)
    if (singletonWs === ws) singletonWs = null
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    reconnectTimer = setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }

  ws.onmessage = (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data)
      handleServerMessage(msg)
    } catch (err) {
      console.warn('[WebSocket] Malformed message:', event.data, err)
    }
  }

  ws.onerror = () => {
    ws.close()
  }
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  singletonWs?.close()
  singletonWs = null
  reconnectDelay = 2000
}

const MAX_QUEUE_SIZE = 100

export function sendWsMessage(msg: ClientMessage) {
  if (singletonWs?.readyState === WebSocket.OPEN) {
    singletonWs.send(JSON.stringify(msg))
    return
  }
  // Deduplicate heartbeat pings in the queue
  if (msg.type === 'ping') {
    const existingPingIndex = messageQueue.findIndex((m) => m.type === 'ping')
    if (existingPingIndex >= 0) {
      messageQueue[existingPingIndex] = msg
      return
    }
  }
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    messageQueue.shift()
  }
  messageQueue.push(msg)
}

export function useWebSocket() {
  useEffect(() => {
    refCount++
    if (refCount === 1) connect()
    return () => {
      refCount--
      if (refCount === 0) disconnect()
    }
  }, [])

  const send = useCallback((msg: ClientMessage) => sendWsMessage(msg), [])

  return { send }
}
