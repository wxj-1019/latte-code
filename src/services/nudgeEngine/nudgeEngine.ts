/**
 * Nudge Engine — automatic self-learning scheduler.
 *
 * At the end of each turn (via handleStopHooks), evaluates trigger conditions
 * and fires background learning tasks (auto-skill extraction) using a forked
 * agent that shares the parent's prompt cache.
 *
 * Pattern: closure-scoped state (init → execute), same as extractMemories
 * and autoDream. Fire-and-forget — does not block the main conversation.
 */

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { count } from '../../utils/array.js'
import { logForDebugging } from '../../utils/debug.js'
import { isNudgeEngineEnabled, getNudgeEngineConfig } from './nudgeConfig.js'
import { executeAutoSkillify } from './nudgeAutoSkillify.js'

// ═══════════════════════════════════════════════════════════════════════════
// Types (inline — single task type for P0)
// ═══════════════════════════════════════════════════════════════════════════

type NudgeStats = {
  turnCount: number
  uniqueTools: string[]
  consecutiveToolCalls: number
  totalToolCalls: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isReadOnlyToolName(name: string): boolean {
  const ro = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LSP'])
  return ro.has(name)
}

function collectStats(context: REPLHookContext): NudgeStats {
  const { messages } = context
  const stats: NudgeStats = {
    turnCount: count(messages, m => m.type === 'user'),
    uniqueTools: [],
    consecutiveToolCalls: 0,
    totalToolCalls: 0,
  }

  const toolNames = new Set<string>()
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const content = m.message.content
    if (typeof content === 'string') continue
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_use' && block.name) {
        toolNames.add(block.name)
        stats.totalToolCalls++
      }
    }
  }
  stats.uniqueTools = [...toolNames]

  // Count non-read-only tools as "complex" tool usage
  stats.consecutiveToolCalls = stats.uniqueTools.filter(
    t => !isReadOnlyToolName(t),
  ).length

  return stats
}

// ═══════════════════════════════════════════════════════════════════════════
// Trigger evaluation (P0: turn_count + tool complexity AND gate)
// ═══════════════════════════════════════════════════════════════════════════

function shouldTrigger(
  stats: NudgeStats,
  turnsSinceLastNudge: number,
): boolean {
  const config = getNudgeEngineConfig()
  const turnThreshold = config.turnThreshold ?? 8
  const complexityThreshold = config.toolComplexityThreshold ?? 3
  const minTurnsBetween = config.minTurnsBetweenNudges ?? 4

  if (turnsSinceLastNudge < minTurnsBetween) return false
  if (stats.turnCount < turnThreshold) return false
  if (stats.consecutiveToolCalls < complexityThreshold) return false

  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// Nudge Runner (closure-scoped, same pattern as autoDream)
// ═══════════════════════════════════════════════════════════════════════════

let nudgeRunner: ((context: REPLHookContext) => Promise<void>) | null = null

export function initNudgeEngine(): void {
  if (!isNudgeEngineEnabled()) return

  let inProgress = false
  let turnsSinceLastNudge = 0
  let nudgeCount = 0

  nudgeRunner = async (context: REPLHookContext) => {
    turnsSinceLastNudge++

    const stats = collectStats(context)
    if (!shouldTrigger(stats, turnsSinceLastNudge)) return

    const config = getNudgeEngineConfig()
    if (nudgeCount >= config.maxPerSession) return

    // Concurrency guard — same pattern as extractMemories line 557
    if (inProgress) return

    inProgress = true
    turnsSinceLastNudge = 0
    nudgeCount++

    logForDebugging(
      `[nudge] auto-skillify firing — turn=${stats.turnCount} tools=[${stats.uniqueTools.join(',')}] nudgeCount=${nudgeCount}/${config.maxPerSession}`,
    )

    try {
      await executeAutoSkillify(context)
    } catch (err) {
      logForDebugging(`[nudge] auto-skillify failed: ${err}`)
    } finally {
      inProgress = false
    }
  }
}

/**
 * Entry point from stopHooks. No-op until initNudgeEngine() has been called.
 * Per-turn cost: O(messages) for stat collection when enabled.
 */
export async function executeNudge(
  context: REPLHookContext,
): Promise<void> {
  if (!isNudgeEngineEnabled()) return
  await nudgeRunner?.(context)
}
