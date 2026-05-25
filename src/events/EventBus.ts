/**
 * Simple event bus for decoupling modules.
 * Used to break the direct dependency between bridge/guiBridge.ts and QueryEngine.ts.
 */

export type EventCallback<T = unknown> = (payload: T) => void | Promise<void>

export class EventBus {
  private listeners = new Map<string, Set<EventCallback>>()

  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as EventCallback)

    return () => this.off(event, callback)
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    this.listeners.get(event)?.delete(callback as EventCallback)
  }

  emit<T>(event: string, payload: T): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return

    for (const callback of callbacks) {
      try {
        const result = callback(payload)
        if (result instanceof Promise) {
          result.catch(err => console.error(`Event handler error for ${event}:`, err))
        }
      } catch (err) {
        console.error(`Event handler error for ${event}:`, err)
      }
    }
  }

  once<T>(event: string, callback: EventCallback<T>): () => void {
    let subscribed = true
    const wrapped = (payload: T) => {
      if (!subscribed) return
      subscribed = false
      this.off(event, wrapped)
      return callback(payload)
    }
    this.on(event, wrapped)
    return () => {
      if (!subscribed) return
      subscribed = false
      this.off(event, wrapped)
    }
  }
}

// Global event bus instance for cross-module communication
export const globalEventBus = new EventBus()

// Event type constants
export const Events = {
  // Query lifecycle events
  QUERY_START: 'query:start',
  QUERY_MESSAGE: 'query:message',
  QUERY_TOOL_CALL: 'query:toolCall',
  QUERY_TOOL_RESULT: 'query:toolResult',
  QUERY_COMPLETE: 'query:complete',
  QUERY_ERROR: 'query:error',

  // Session events
  SESSION_CREATED: 'session:created',
  SESSION_UPDATED: 'session:updated',
  SESSION_ENDED: 'session:ended',

  // Permission events
  PERMISSION_REQUESTED: 'permission:requested',
  PERMISSION_DECIDED: 'permission:decided',

  // Bridge events
  BRIDGE_MESSAGE: 'bridge:message',
  BRIDGE_COMMAND: 'bridge:command',
} as const
