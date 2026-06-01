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

import { type Goal, getExecutionProgress, getErrorRecoveryHint, getReflectionPrompt, getSubtaskProgress, getNextSubtask, getCompactStatus } from './goalState.js'

/**
 * Build the continuation prompt injected when a goal is active.
 * This reminds the model of the objective and encourages progress.
 * Includes self-evaluation requirement for condition-mode goals.
 */
export function buildGoalContinuationPrompt(goal: Goal): string {
  const remainingTurns = goal.maxTurns - goal.turnsUsed
  const urgencyPrefix = remainingTurns <= 3
    ? `[URGENT: ${remainingTurns} turn${remainingTurns === 1 ? '' : 's'} left - focus on completion]\n`
    : ''

  const conditionSection = goal.mode === 'condition' && goal.condition
    ? `\nCondition: ${goal.condition}`
    : ''

  const evaluatorSection = goal.evaluatorReason
    ? `\nLast eval: ${goal.evaluatorReason}`
    : ''

  // Include execution plan progress if available
  const progressSection = getExecutionProgress()
    ? `\nExecution Plan:\n${getExecutionProgress()}`
    : ''

  // Include subtask progress if available
  const subtaskProgress = getSubtaskProgress()
  const subtaskSection = subtaskProgress ? `\nSubtasks:\n${subtaskProgress}` : ''

  // Get next subtask to execute
  const nextSubtask = getNextSubtask()
  const nextSubtaskHint = nextSubtask ? `\nNext subtask: ${nextSubtask.description}` : ''

  // Resource warnings
  const turnUsagePercent = Math.round((goal.turnsUsed / goal.maxTurns) * 100)
  let resourceWarning = ''
  if (turnUsagePercent >= 80) {
    resourceWarning = '\n[WARNING: >80% turns used - prioritize critical steps]'
  } else if (turnUsagePercent >= 60) {
    resourceWarning = '\n[NOTICE: >60% turns used - focus on high-impact items]'
  }

  // Error recovery hint
  const errorHint = getErrorRecoveryHint()
  const errorSection = errorHint ? `\nError Recovery: ${errorHint}` : ''

  // Milestone check - every 5 turns
  const milestoneCheck = goal.turnsUsed > 0 && goal.turnsUsed % 5 === 0
    ? '\n[MILESTONE: Pause and verify progress before continuing]'
    : ''

  // Self-reflection prompt
  const reflectionPrompt = getReflectionPrompt()
  const reflectionSection = reflectionPrompt ? `\n${reflectionPrompt}` : ''

  // Context compression status
  const compactStatus = getCompactStatus()
  const compactSection = compactStatus ? `\n${compactStatus}` : ''

  return `<goal>${urgencyPrefix}Objective: ${goal.objective}${conditionSection}${evaluatorSection}
Progress: ${goal.turnsUsed}/${goal.maxTurns} (${remainingTurns} left)${progressSection}${subtaskSection}${nextSubtaskHint}${resourceWarning}${errorSection}${milestoneCheck}${reflectionSection}${compactSection}

CONTINUATION INSTRUCTIONS:
- Review your execution plan and continue from where you left off
- Execute the next most impactful step from your plan
- Update progress tracking (mark completed steps with [x])
- If a step failed, try an alternative approach or skip it
- If the goal is fully achieved, output [GOAL_COMPLETED]
- Do NOT ask for user input - proceed autonomously
- If stuck, try alternative approaches</goal>`
}

/**
 * Build the budget limit prompt when max turns reached.
 */
export function buildGoalBudgetLimitPrompt(goal: Goal): string {
  return `<goal>BUDGET EXHAUSTED (${goal.maxTurns} turns). Objective: ${goal.objective}

FINAL TASK:
- Summarize what was accomplished
- List any remaining items from the plan
- Note any blockers or issues encountered
- Suggest concrete next steps for manual continuation</goal>`
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
  return `<goal>AUTO-COMPLETED: ${goal.objective} — no tool calls for ${consecutiveIdleTurns} turns. Provide a final summary of what was accomplished.</goal>`
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
 * Enforces a structured workflow: research → plan → execute → verify
 */
export function buildGoalInitialPrompt(objective: string, maxTurns: number, mode: 'objective' | 'condition' = 'objective', condition?: string): string {
  const conditionSection = mode === 'condition' && condition
    ? `\nCondition: ${condition}`
    : ''

  return `<goal>NEW GOAL: ${objective}${conditionSection} | Budget: ${maxTurns} turns

WORKFLOW (must follow in order):

1. RESEARCH PHASE:
   - Use Grep, Glob, Read, WebSearch, WebFetch tools to gather information
   - Understand the current state, constraints, and requirements
   - Do NOT skip this phase - thorough research prevents wasted turns

2. PLAN PHASE:
   - Generate a structured execution plan with numbered steps
   - Each step should be specific and actionable
   - Output the plan as a clear markdown list before executing
   - Identify steps that can be parallelized (independent tasks)

3. EXECUTE PHASE:
   - Follow the plan step by step
   - Use tools to implement each step
   - Track progress: mark completed steps with [x]
   - For independent steps, consider executing in parallel using multiple tool calls
   - If a step fails, record the error and try an alternative approach

4. VERIFY PHASE:
   - After execution, verify the results meet the goal
   - Run tests, check outputs, validate completion criteria
   - If not satisfied, iterate and fix issues

5. ADAPTATION:
   - If execution reveals the plan needs adjustment, update it
   - Add, remove, or reorder steps as needed
   - Document why changes were made

6. COMPLETION:
   - Only output [GOAL_COMPLETED] when the goal is fully achieved
   - Provide a brief summary of what was accomplished

IMPORTANT:
- Do NOT ask the user for input - proceed autonomously
- Do NOT wait for permission - execute the plan directly
- If stuck, try alternative approaches rather than stopping</goal>`
}
