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

import { type Goal, getExecutionProgress, getErrorRecoveryHint, getReflectionPrompt, getSubtaskProgress, getNextSubtask, getCompactStatus, isCompletionSignalSent, getRelevantLessons, getReplanPrompt, getRelevantSkills, getParallelHint, getEpisodicSummary, getSkillLibrarySummary, getGoalConfig, getVerificationStatus, getBudgetStatus, getDeprecatedSkills } from './goalState.js'

/**
 * Build the continuation prompt injected when a goal is active.
 * This reminds the model of the objective and encourages progress.
 * Includes self-evaluation requirement for condition-mode goals.
 *
 * Now includes completion signal check to prevent repeated signaling.
 */
export function buildGoalContinuationPrompt(goal: Goal): string {
  // If completion signal already sent, return minimal prompt to save tokens
  if (isCompletionSignalSent()) {
    return `<goal>Objective: ${goal.objective}
Status: completing...

[GOAL_COMPLETED]</goal>`
  }

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
  const executionProgress = getExecutionProgress()
  const progressSection = executionProgress
    ? `\nExecution Plan:\n${executionProgress}`
    : ''

  // Include subtask progress if available
  const subtaskProgress = getSubtaskProgress()
  const subtaskSection = subtaskProgress ? `\nSubtasks:\n${subtaskProgress}` : ''

  // Get next subtask to execute
  const nextSubtask = getNextSubtask()
  const nextSubtaskHint = nextSubtask ? `\nNext subtask: ${nextSubtask.description}` : ''

  // Resource warnings (thresholds configurable via env)
  const config = getGoalConfig()
  const warn60 = parseInt(config.resourceWarning60, 10) || 60
  const warn80 = parseInt(config.resourceWarning80, 10) || 80
  const turnUsagePercent = Math.round((goal.turnsUsed / goal.maxTurns) * 100)
  let resourceWarning = ''
  if (turnUsagePercent >= warn80) {
    resourceWarning = `\n[WARNING: >${warn80}% turns used - prioritize critical steps]`
  } else if (turnUsagePercent >= warn60) {
    resourceWarning = `\n[NOTICE: >${warn60}% turns used - focus on high-impact items]`
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

  // Episodic memory lessons (Reflexion pattern)
  const lessons = getRelevantLessons(3)
  const lessonsSection = lessons ? `\nLessons from past failures:\n${lessons}` : ''

  // Adaptive re-planning check
  const replanPrompt = getReplanPrompt()
  const replanSection = replanPrompt ? `\n${replanPrompt}` : ''

  // Skill library hints (Voyager pattern)
  const skills = getRelevantSkills(goal.objective)
  const skillsSection = skills ? `\nRelevant skills:\n${skills}` : ''

  // Parallel execution hints
  const parallelHint = getParallelHint()
  const parallelSection = parallelHint ? `\n${parallelHint}` : ''

  // Verification status
  const verificationStatus = getVerificationStatus()
  const verificationSection = verificationStatus ? `\n${verificationStatus}` : ''

  // Budget status (token cost guardrails)
  const budgetStatus = getBudgetStatus()
  const budgetSection = budgetStatus ? `\n${budgetStatus}` : ''

  // Deprecated skills warning
  const deprecatedSkills = getDeprecatedSkills()
  const deprecatedSection = deprecatedSkills.length > 0
    ? `\nDeprecated skills (avoid): ${deprecatedSkills.map(s => `${s.name} (${s.reason})`).join(', ')}`
    : ''

  // Status summaries
  const episodicSummary = getEpisodicSummary()
  const skillSummary = getSkillLibrarySummary()
  const statusSummaries = [episodicSummary, skillSummary].filter(Boolean)
  const statusSection = statusSummaries.length ? `\n${statusSummaries.join(' | ')}` : ''

  return `<goal>${urgencyPrefix}Objective: ${goal.objective}${conditionSection}${evaluatorSection}
Progress: ${goal.turnsUsed}/${goal.maxTurns} (${remainingTurns} left)${progressSection}${subtaskSection}${nextSubtaskHint}${resourceWarning}${errorSection}${lessonsSection}${replanSection}${skillsSection}${parallelSection}${milestoneCheck}${reflectionSection}${compactSection}${verificationSection}${budgetSection}${deprecatedSection}${statusSection}

CONTINUATION INSTRUCTIONS:
- Review your execution plan and continue from where you left off
- Execute the next most impactful step from your plan
- Update progress tracking (mark completed steps with [x])
- Learn from past failures: apply lessons from episodic memory
- If a step failed, record the lesson and try an alternative approach
- If re-planning is required, generate a new shorter plan
- Use learned skills when applicable
- If parallelizable tasks exist, execute them together
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
 * Build the suppression prompt when goal auto-completes due to inactivity.
 */
export function buildGoalSuppressionPrompt(goal: Goal, consecutiveIdleTurns: number): string {
  return `<goal>AUTO-COMPLETED: ${goal.objective} — no tool calls for ${consecutiveIdleTurns} turns. Provide a final summary of what was accomplished.</goal>`
}

/**
 * Build the evaluator prompt that asks the model to self-evaluate goal completion.
 * Enhanced with structured verification checklist.
 *
 * Returns the prompt string to be injected at the end of a turn.
 */
export function buildGoalEvaluatorPrompt(goal: Goal): string {
  const condition = goal.condition || goal.objective

  const verificationCmds = goal.verification?.commands
  const verificationSection = verificationCmds?.length
    ? `\n5. Have these verification commands passed: ${verificationCmds.join(', ')}?`
    : ''

  return `<eval>Is this condition met? "${condition}"

VERIFICATION CHECKLIST (answer before declaring complete):
1. Have all planned steps been executed?
2. Have verification commands been run (tests, build, lint)?
3. Are there any remaining errors or failures?
4. Does the output match the original objective?${verificationSection}

Format: COMPLETED: [YES/NO] | REASON: [one sentence]
If YES, also output [GOAL_COMPLETED] on its own line.
If NO, list what still needs to be done.</eval>`
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
   - Check if any available skills match the task (use Skill tool when appropriate)
   - Understand the current state, constraints, and requirements
   - Do NOT skip this phase - thorough research prevents wasted turns

2. PLAN PHASE:
   - Generate a structured execution plan with numbered steps
   - Each step should be specific and actionable
   - Output the plan as a clear markdown list before executing
   - Identify steps that can be parallelized (independent tasks)
   - Identify which steps can leverage existing skills

3. EXECUTE PHASE:
   - Follow the plan step by step
   - Use tools to implement each step
   - Invoke relevant skills via the Skill tool when they can help
   - Track progress: mark completed steps with [x]
   - For independent steps, consider executing in parallel using multiple tool calls
   - If a step fails, record the LESSON LEARNED and try an alternative approach

4. LEARNING PHASE (after each failure):
   - Record what was attempted and why it failed
   - Extract a reusable lesson for future steps
   - Apply lessons to avoid repeating the same mistakes

5. VERIFY PHASE:
   - After execution, verify the results meet the goal
   - Run tests, check outputs, validate completion criteria
   - If not satisfied, iterate and fix issues

6. ADAPTATION:
   - If execution reveals the plan needs adjustment, update it
   - Add, remove, or reorder steps as needed
   - Document why changes were made
   - If >60% turns used with <30% progress, generate a NEW shorter plan

7. COMPLETION:
   - Only output [GOAL_COMPLETED] when the goal is FULLY achieved
   - Before completing, run verification commands (tests, build, etc.)
   - Provide a brief summary of what was accomplished

IMPORTANT:
- Do NOT ask the user for input - proceed autonomously
- Do NOT wait for permission - execute the plan directly
- If stuck, try alternative approaches rather than stopping
- Learn from failures: record lessons to avoid repeating mistakes
- If replanning is triggered, focus on critical items only</goal>`
}
