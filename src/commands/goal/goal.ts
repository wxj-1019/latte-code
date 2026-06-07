/**
 * /goal command implementation.
 *
 * Syntax:
 *   /goal <objective>  - Set a new goal
 *   /goal              - Show current goal status
 *   /goal pause        - Pause active goal
 *   /goal resume       - Resume paused goal
 *   /goal clear        - Clear current goal
 */

import type { LocalCommandCall, LocalCommandResult, LocalJSXCommandContext } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  clearGoal,
  formatGoalStatus,
  getGoal,
  isConditionMode,
  getGoalCondition,
  pauseGoal,
  resumeGoal,
  setGoal,
  getOriginalPermissionMode,
  setOriginalPermissionMode,
  restoreOriginalPermissionMode,
  initReflection,
  getGoalConfig,
} from './goalState.js'
import { buildGoalInitialPrompt, buildGoalContinuationPrompt } from './goalPrompts.js'
import { captureTerminalState, formatTerminalContext } from '../../services/terminalAwareness.js'

const SUBCOMMANDS = ['pause', 'resume', 'clear', 'status', 'stop', 'off', 'reset', 'cancel']

/**
 * Find the closest matching subcommand for typo correction.
 * Uses simple Levenshtein distance for fuzzy matching.
 */
export function findClosestSubcommand(input: string): string | null {
  const lower = input.toLowerCase()
  let best: string | null = null
  let bestScore = Infinity

  // Stricter threshold for short inputs to avoid over-matching
  // e.g. "st" → "stop" (dist 2) but user might mean "star"
  const maxDist = lower.length <= 3 ? 1 : 2

  for (const cmd of SUBCOMMANDS) {
    const dist = levenshteinDistance(lower, cmd)
    if (dist < bestScore && dist <= maxDist) {
      bestScore = dist
      best = cmd
    }
  }

  return best
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // Use rolling array for O(min(m,n)) space
  const [shorter, longer] = m <= n ? [a, b] : [b, a]
  const sLen = shorter.length
  const lLen = longer.length

  let prev = Array.from({ length: sLen + 1 }, (_, i) => i)
  let curr = new Array<number>(sLen + 1)

  for (let i = 1; i <= lLen; i++) {
    curr[0] = i
    for (let j = 1; j <= sLen; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j]! + 1,      // deletion
        curr[j - 1]! + 1,  // insertion
        prev[j - 1]! + cost // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[sLen]!
}

function parseMaxTurns(): number {
  const config = getGoalConfig()
  const parsed = parseInt(config.env_GOAL_MAX_TURNS, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100
}

/**
 * Enable acceptEdits mode when a goal is set.
 * Auto-approves workspace edits while requiring user confirmation
 * for external operations. Safer than the previous bypassPermissions.
 * Restores original mode when goal is cleared/paused.
 */
function enableGoalAutoApproval(context: ToolUseContext): void {
  try {
    const appState = context.getAppState()
    if (!appState || !appState.toolPermissionContext) return

    const currentMode = appState.toolPermissionContext.mode
    // Already in bypass — nothing to do (user started with --dangerously-skip-permissions, etc.)
    if (currentMode === 'bypassPermissions') return
    // Save current mode if not already saved
    if (!getOriginalPermissionMode()) {
      setOriginalPermissionMode(currentMode)
    }
    // Switch to acceptEdits mode — safer than bypassPermissions
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        mode: 'acceptEdits',
      },
    }))
  } catch (e) {
    // Degrade gracefully — goal continues without permission change
  }
}

const MAX_OBJECTIVE_LENGTH = 500

export const call: LocalCommandCall = async (
  args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> => {
  const trimmed = args.trim()

  // No args - show status
  if (!trimmed) {
    return { type: 'text', value: formatGoalStatus() }
  }

  // Subcommands
  const subcommand = trimmed.toLowerCase()

  switch (subcommand) {
    case 'pause': {
      const goal = getGoal()
      if (!goal) {
        return { type: 'text', value: 'No active goal to pause.' }
      }
      if (goal.status !== 'active') {
        return { type: 'text', value: `Goal is already ${goal.status}.` }
      }
      pauseGoal()
      restoreOriginalPermissionMode(context.setAppState.bind(context))
      return { type: 'text', value: `Goal paused: ${goal.objective}` }
    }

    case 'resume': {
      const goal = getGoal()
      if (!goal) {
        return { type: 'text', value: 'No goal to resume. Set one with /goal <objective>' }
      }
      if (goal.status !== 'paused') {
        return { type: 'text', value: `Goal is ${goal.status}, not paused.` }
      }
      resumeGoal()
      enableGoalAutoApproval(context)
      const continuationPrompt = buildGoalContinuationPrompt(getGoal()!)
      return { type: 'query', value: continuationPrompt, displayText: `Goal resumed: ${goal.objective}` }
    }

    case 'clear':
    case 'stop':
    case 'off':
    case 'reset':
    case 'cancel': {
      const goal = getGoal()
      if (!goal) {
        return { type: 'text', value: 'No active goal to clear.' }
      }
      const objective = goal.objective
      clearGoal()
      restoreOriginalPermissionMode(context.setAppState.bind(context))
      return { type: 'text', value: `Goal cleared: ${objective}` }
    }

    default: {
      // Check if it looks like a subcommand typo
      if (trimmed.length < 2) {
        return { type: 'text', value: 'Goal objective is too short. Please provide a meaningful description.' }
      }

      if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
        return { type: 'text', value: `Goal objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters, got ${trimmed.length}).` }
      }

      // Only check for subcommand typos on short inputs to avoid false positives
      // on real objectives like "clear the cache" matching "clear"
      if (trimmed.length <= 12) {
        const closest = findClosestSubcommand(trimmed)
        if (closest) {
          return { type: 'text', value: `Unknown subcommand "${trimmed}". Did you mean: /goal ${closest}?` }
        }
      }

      // Warn if overwriting existing active goal
      const existingGoal = getGoal()
      if (existingGoal && existingGoal.status === 'active') {
        // Overwrite and continue
        clearGoal()
        restoreOriginalPermissionMode(context.setAppState.bind(context))
      }

      const objective = trimmed
      const maxTurns = parseMaxTurns()
      setGoal(objective, maxTurns)

      // Initialize self-reflection mechanism
      initReflection()

      // Enable auto-approval mode with Smart Approvals safety net
      enableGoalAutoApproval(context)

      // Inject terminal context so the model knows the current environment
      const terminalState = captureTerminalState()
      const terminalContext = formatTerminalContext(terminalState)

      // Return initial prompt to be sent to the model
      const mode = isConditionMode() ? 'condition' as const : 'objective' as const
      const condition = getGoalCondition()
      const initialPrompt = buildGoalInitialPrompt(objective, maxTurns, mode, condition)

      const fullPrompt = initialPrompt + '\n\n' + terminalContext

      const modeLabel = mode === 'condition' ? 'Condition' : 'Objective'
      return { type: 'query', value: fullPrompt, displayText: `Goal set: ${objective}\nMode: ${modeLabel}\nMax turns: ${maxTurns}` }
    }
  }
}
