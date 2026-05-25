/**
 * Prompt templates for /goal command.
 *
 * Injected at the end of each turn to maintain goal context
 * and guide the model toward completion.
 *
 * Design principles:
 * - Use XML tags for clear separation from user content
 * - Be concise to minimize token usage
 * - Provide actionable guidance, not just reminders
 * - Include progress metrics for context awareness
 */

import type { Goal } from './goalState.js'

/**
 * Build the continuation prompt injected when a goal is active.
 * This reminds the model of the objective and encourages progress.
 * Includes self-evaluation requirement for condition-mode goals.
 */
export function buildGoalContinuationPrompt(goal: Goal): string {
  const remainingTurns = goal.maxTurns - goal.turnsUsed
  const urgencyPrefix = remainingTurns <= 2
    ? `[URGENT: ${remainingTurns} turn${remainingTurns === 1 ? '' : 's'} left]\n`
    : ''

  const conditionSection = goal.mode === 'condition' && goal.condition
    ? `\nCondition: ${goal.condition}`
    : ''

  const evaluatorSection = goal.evaluatorReason
    ? `\nLast eval: ${goal.evaluatorReason}`
    : ''

  return `<goal>${urgencyPrefix}Objective: ${goal.objective}${conditionSection}${evaluatorSection}
Progress: ${goal.turnsUsed}/${goal.maxTurns} (${remainingTurns} left)
Guidelines: assess completion → output [GOAL_COMPLETED] if done → else take the most impactful step → avoid redundancy</goal>`
}

/**
 * Build the budget limit prompt when max turns reached.
 */
export function buildGoalBudgetLimitPrompt(goal: Goal): string {
  return `<goal>BUDGET EXHAUSTED (${goal.maxTurns} turns). Objective: ${goal.objective}
Summarize accomplishments, note unfinished items, suggest next steps.</goal>`
}

/**
 * Build the completion prompt when goal is marked complete.
 * NOTE: Not currently invoked by the goal loop — completion is detected
 * via the [GOAL_COMPLETED] marker in assistant text. Kept for API completeness.
 */
export function buildGoalCompletePrompt(goal: Goal): string {
  return `<goal>COMPLETED: ${goal.objective} (${goal.turnsUsed}/${goal.maxTurns} turns). Provide a concise summary.</goal>`
}

/**
 * Build the suppression prompt when goal auto-completes due to inactivity.
 */
export function buildGoalSuppressionPrompt(goal: Goal, consecutiveIdleTurns: number): string {
  return `<goal>AUTO-COMPLETED: ${goal.objective} — no tool calls for ${consecutiveIdleTurns} turns. Set a new goal with /goal if needed.</goal>`
}

/**
 * Build the evaluator prompt that asks the model to self-evaluate goal completion.
 * This simulates Claude Code's independent evaluator (Haiku) by prompting the
 * main model to assess whether the completion condition is met.
 *
 * Returns the prompt string to be injected at the end of a turn.
 */
export function buildGoalEvaluatorPrompt(goal: Goal): string {
  const condition = goal.condition || goal.objective

  return `<eval>Is this condition met? "${condition}"
Format: COMPLETED: [YES/NO] | REASON: [one sentence]
If YES, also output [GOAL_COMPLETED] on its own line.</eval>`
}

/**
 * Build the initial prompt when a goal is first set, with condition-mode awareness.
 */
export function buildGoalInitialPrompt(objective: string, maxTurns: number, mode: 'objective' | 'condition' = 'objective', condition?: string): string {
  const conditionSection = mode === 'condition' && condition
    ? `\nCondition: ${condition}`
    : ''

  return `<goal>NEW GOAL: ${objective}${conditionSection} | Budget: ${maxTurns} turns
Mode: plan → execute → verify → output [GOAL_COMPLETED] when done. Ask user if stuck.</goal>`
}
