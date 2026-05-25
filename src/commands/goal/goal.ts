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

import {
  clearGoal,
  formatGoalStatus,
  getGoal,
  isConditionMode,
  getGoalCondition,
  pauseGoal,
  resumeGoal,
  setGoal,
} from './goalState.js'
import { buildGoalInitialPrompt } from './goalPrompts.js'

const SUBCOMMANDS = ['pause', 'resume', 'clear', 'status', 'stop', 'off', 'reset', 'cancel']

/**
 * Find the closest matching subcommand for typo correction.
 * Uses simple Levenshtein distance for fuzzy matching.
 */
function findClosestSubcommand(input: string): string | null {
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

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,      // deletion
        dp[i]![j - 1]! + 1,      // insertion
        dp[i - 1]![j - 1]! + cost // substitution
      )
    }
  }

  return dp[m]![n]!
}

function parseMaxTurns(): number {
  const maxTurnsEnv = process.env.GOAL_MAX_TURNS
  if (!maxTurnsEnv) {
    return 10
  }
  const parsed = parseInt(maxTurnsEnv, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return 10
  }
  return parsed
}

export default async function goal(args: string): Promise<string> {
  const trimmed = args.trim()

  // No args - show status
  if (!trimmed) {
    return formatGoalStatus()
  }

  // Subcommands
  const subcommand = trimmed.toLowerCase()

  switch (subcommand) {
    case 'pause': {
      const goal = getGoal()
      if (!goal) {
        return 'No active goal to pause.'
      }
      if (goal.status !== 'active') {
        return `Goal is already ${goal.status}.`
      }
      pauseGoal()
      return `Goal paused: ${goal.objective}`
    }

    case 'resume': {
      const goal = getGoal()
      if (!goal) {
        return 'No goal to resume. Set one with /goal <objective>'
      }
      if (goal.status !== 'paused') {
        return `Goal is ${goal.status}, not paused.`
      }
      resumeGoal()
      return `Goal resumed: ${goal.objective}`
    }

    case 'clear':
    case 'stop':
    case 'off':
    case 'reset':
    case 'cancel': {
      const goal = getGoal()
      if (!goal) {
        return 'No active goal to clear.'
      }
      const objective = goal.objective
      clearGoal()
      return `Goal cleared: ${objective}`
    }

    default: {
      // Check if it looks like a subcommand typo
      if (trimmed.length < 2) {
        return 'Goal objective is too short. Please provide a meaningful description.'
      }

      const closest = findClosestSubcommand(trimmed)
      if (closest) {
        return `Unknown subcommand "${trimmed}". Did you mean: /goal ${closest}?`
      }

      // Warn if overwriting existing active goal
      const existingGoal = getGoal()
      if (existingGoal && existingGoal.status === 'active') {
        // Overwrite and continue
        clearGoal()
      }

      const objective = trimmed
      const maxTurns = parseMaxTurns()
      const goal = setGoal(objective, maxTurns)

      // Return initial prompt to be sent to the model
      const mode = isConditionMode() ? 'condition' as const : 'objective' as const
      const condition = getGoalCondition()
      const initialPrompt = buildGoalInitialPrompt(objective, maxTurns, mode, condition)

      const modeLabel = mode === 'condition' ? 'Condition' : 'Objective'
      return `Goal set: ${objective}\nMode: ${modeLabel}\nMax turns: ${maxTurns}\n\n${initialPrompt}`
    }
  }
}
