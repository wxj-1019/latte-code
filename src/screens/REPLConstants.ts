import type { MCPServerConnection } from '../services/mcp/types.js';
import type { ScrollBoxHandle } from '../components/ScrollBox.js';

// Stable empty array reference to avoid re-renders from dependency changes.
// Must be a module-level constant rather than a new [] literal on every render.
export const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

// Stable stub for useAssistantHistory's non-KAIROS branch — avoids a new
// function identity each render, which would break composedOnScroll's memo.
export const HISTORY_STUB = {
  maybeLoadOlder: (_: ScrollBoxHandle) => {}
};

// Window after a user-initiated scroll during which type-into-empty does NOT
// repin to bottom.
export const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}
