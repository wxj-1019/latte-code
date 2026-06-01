/**
 * Goal state management for /goal command.
 *
 * Based on Codex /goal architecture:
 * - Session-scoped memory state (no SQLite for simplicity)
 * - Four states: active, paused, budget_limited, complete
 * - Tracks turns used against max turns budget
 * - Optional session persistence via transcript metadata
 */

// biome-ignore lint/correctness/useExhaustiveDependencies: dynamic import to avoid circular deps
const sessionStorageModule = () => import('../../utils/sessionStorage.js')

export type GoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export type GoalMode = 'objective' | 'condition'

export type Goal = {
  id: string
  objective: string
  status: GoalStatus
  maxTurns: number
  turnsUsed: number
  createdAt: number
  updatedAt: number
  mode: GoalMode
  condition?: string
  evaluatorReason?: string
  tokensSpent: number
  startedAt: number
  executionPlan?: string[] // Track the execution plan steps
  currentStep?: number // Current step being executed
  completedSteps?: number[] // Indices of completed steps
  failedSteps?: number[] // Indices of failed steps that need retry
  lastError?: string // Last error encountered
  retryCount?: number // Number of retries for current step
  // Self-reflection mechanism
  reflectionInterval?: number // How often to reflect (every N turns)
  lastReflectionTurn?: number // Last turn when reflection was done
  reflections?: string[] // History of reflections
  strategyChanges?: string[] //记录策略调整
  // Subtask decomposition
  subtasks?: Subtask[] //分解的子任务
  parentGoalId?: string //父目标ID（用于子任务）
  // Context compression tracking
  compactCount?: number // Number of times context was compacted
  lastCompactTurn?: number // Last turn when context was compacted
  compactSummaries?: string[] // Summaries from compactions
}

export type Subtask = {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependencies?: number[] //依赖的子任务索引
  result?: string //执行结果
}

// Session-scoped goal state
let currentGoal: Goal | null = null

// Track the original permission mode before goal was set (for restoration)
let originalPermissionMode: string | null = null

// Track consecutive turns without tool calls (continuation suppression)
let consecutiveZeroToolCalls = 0
const MAX_ZERO_TOOL_CALLS = parseEnvInt('GOAL_MAX_ZERO_TOOL_CALLS', 5)

// Minimum and maximum allowed turns
const MIN_TURNS = 1
const MAX_TURNS = parseEnvInt('GOAL_MAX_TURNS_LIMIT', 200)

// Default reflection interval (configurable via env)
const DEFAULT_REFLECTION_INTERVAL = parseEnvInt('GOAL_REFLECTION_INTERVAL', 5)

// Resource warning thresholds
const RESOURCE_WARNING_60 = parseEnvInt('GOAL_RESOURCE_WARNING_60', 60)
const RESOURCE_WARNING_80 = parseEnvInt('GOAL_RESOURCE_WARNING_80', 80)

// Helper to parse environment variable as integer with fallback
function parseEnvInt(key: string, fallback: number): number {
  const envValue = process.env[key]
  if (!envValue) return fallback
  const parsed = parseInt(envValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Get current goal configuration as a formatted string.
 * Useful for debugging and displaying configuration.
 */
export function getGoalConfig(): Record<string, string> {
  return {
    defaultMaxTurns: '50',
    maxTurnsLimit: String(MAX_TURNS),
    maxZeroToolCalls: String(MAX_ZERO_TOOL_CALLS),
    reflectionInterval: String(DEFAULT_REFLECTION_INTERVAL),
    env_GOAL_MAX_TURNS: process.env.GOAL_MAX_TURNS || 'not set',
    env_GOAL_MAX_TURNS_LIMIT: process.env.GOAL_MAX_TURNS_LIMIT || 'not set',
    env_GOAL_MAX_ZERO_TOOL_CALLS: process.env.GOAL_MAX_ZERO_TOOL_CALLS || 'not set',
    env_GOAL_REFLECTION_INTERVAL: process.env.GOAL_REFLECTION_INTERVAL || 'not set',
  }
}

function generateGoalId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function clampMaxTurns(maxTurns: number): number {
  if (!Number.isFinite(maxTurns)) {
    return 50 // sensible default for autonomous execution
  }
  return Math.max(MIN_TURNS, Math.min(MAX_TURNS, Math.floor(maxTurns)))
}

function detectGoalMode(input: string): { mode: GoalMode; condition?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { mode: 'objective' }

  const lower = trimmed.toLowerCase()

  // Explicit condition syntax: starts with "when" or "if"
  if (lower.startsWith('when ') || lower.startsWith('if ')) {
    return { mode: 'condition', condition: trimmed }
  }

  // Condition mode: contains measurable keywords (word-boundary matched)
  // Use precise patterns to avoid false positives on common English words
  // e.g. "all" must not match "install", "diff" must not match "difference"
  const conditionPatterns = [
    /\bpass(?:es)?\b/,
    /\bexit(?:\s+code|\s+0)?\b/,
    /\bno\s+errors?\b/, /\bno\s+failures?\b/,
    /\ball\s+tests?\s+pass\b/, /\btests?\s+pass\b/,
    /\bcompiles?\b/, /\bbuilds?\b/,
    /\bgit\s+status\b/, /\bgit\s+diff\b/,
  ]
  const hasConditionMarker = conditionPatterns.some(p => p.test(lower))

  if (hasConditionMarker) {
    return { mode: 'condition', condition: trimmed }
  }
  return { mode: 'objective' }
}

function persistGoalState(): void {
  try {
    const serialized = serializeGoal()
    if (serialized !== null) {
      sessionStorageModule().then(m => m.saveGoalState(serialized)).catch(() => {
        // Silently ignore persistence errors
      })
    }
  } catch {
    // Ignore persistence errors
  }
}

export function setGoal(objective: string, maxTurns: number = 50): Goal {
  const now = Date.now()
  const clampedMaxTurns = clampMaxTurns(maxTurns)
  const { mode, condition } = detectGoalMode(objective)

  currentGoal = {
    id: generateGoalId(),
    objective: objective.trim(),
    status: 'active',
    maxTurns: clampedMaxTurns,
    turnsUsed: 0,
    createdAt: now,
    updatedAt: now,
    mode,
    condition,
    tokensSpent: 0,
    startedAt: now,
  }
  consecutiveZeroToolCalls = 0
  persistGoalState()
  return currentGoal
}

export function getGoal(): Goal | null {
  return currentGoal
}

export function pauseGoal(): void {
  if (currentGoal && currentGoal.status === 'active') {
    currentGoal.status = 'paused'
    currentGoal.updatedAt = Date.now()
  }
}

export function resumeGoal(): void {
  if (currentGoal && currentGoal.status === 'paused') {
    currentGoal.status = 'active'
    currentGoal.updatedAt = Date.now()
  }
}

export function clearGoal(): void {
  currentGoal = null
  consecutiveZeroToolCalls = 0
  persistGoalState()
}

export function getOriginalPermissionMode(): string | null {
  return originalPermissionMode
}

export function setOriginalPermissionMode(mode: string | null): void {
  originalPermissionMode = mode
}

type SetAppStateFn = (updater: (prev: any) => any) => void

/**
 * Restore the original permission mode that was active before the goal was set.
 * Shared by both goal.ts (command handler) and query.ts (query loop).
 */
export function restoreOriginalPermissionMode(setAppState: SetAppStateFn): void {
  const originalMode = getOriginalPermissionMode()
  if (originalMode) {
    setAppState((prev: any) => ({
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        mode: originalMode,
      },
    }))
    setOriginalPermissionMode(null)
  }
}

export function markGoalComplete(): void {
  if (currentGoal) {
    currentGoal.status = 'complete'
    currentGoal.updatedAt = Date.now()
    persistGoalState()
  }
}

export function markGoalBudgetLimited(): void {
  if (currentGoal) {
    currentGoal.status = 'budget_limited'
    currentGoal.updatedAt = Date.now()
    persistGoalState()
  }
}

export function incrementTurn(): void {
  if (currentGoal) {
    currentGoal.turnsUsed++
    currentGoal.updatedAt = Date.now()
  }
}

export function isGoalActive(): boolean {
  return currentGoal?.status === 'active'
}

export function isGoalPaused(): boolean {
  return currentGoal?.status === 'paused'
}

export function recordToolCallPresence(hasToolCalls: boolean): void {
  if (hasToolCalls) {
    consecutiveZeroToolCalls = 0
  } else {
    consecutiveZeroToolCalls++
  }
}

export function shouldSuppressContinuation(): boolean {
  return consecutiveZeroToolCalls >= MAX_ZERO_TOOL_CALLS
}

export function getConsecutiveZeroToolCalls(): number {
  return consecutiveZeroToolCalls
}

export function resetZeroToolCallCounter(): void {
  consecutiveZeroToolCalls = 0
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return `${tokens}`
}

export function formatGoalStatus(): string {
  if (!currentGoal) {
    return 'No active goal. Set one with /goal <objective>'
  }

  const { objective, status, turnsUsed, maxTurns, mode, condition, evaluatorReason, tokensSpent, startedAt } = currentGoal
  const statusEmoji = {
    active: '\u25cf',
    paused: '\u23f8',
    budget_limited: '\u26a0',
    complete: '\u2713',
  }[status]

  const progressPercent = Math.round((turnsUsed / maxTurns) * 100)
  const progressBar = turnsUsed >= maxTurns
    ? ' [LIMIT REACHED]'
    : ` (${progressPercent}%)`

  const duration = formatDuration(Date.now() - startedAt)
  const tokenStr = tokensSpent > 0 ? ` | ${formatTokens(tokensSpent)} tokens` : ''
  const reasonStr = evaluatorReason ? ` | "${evaluatorReason}"` : ''
  const modeStr = mode === 'condition' && condition ? `\n  Condition: ${condition}` : ''

  return `[${statusEmoji}] Goal: ${objective}${modeStr}\n  Status: ${status} | ${turnsUsed}/${maxTurns} turns${progressBar} | ${duration}${tokenStr}${reasonStr}`
}

export function updateEvaluatorReason(reason: string): void {
  if (currentGoal) {
    currentGoal.evaluatorReason = reason
    currentGoal.updatedAt = Date.now()
  }
}

export function addTokensSpent(tokens: number): void {
  if (currentGoal) {
    currentGoal.tokensSpent += tokens
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Update the execution plan for the current goal.
 * This helps the model track progress across turns.
 */
export function updateExecutionPlan(steps: string[]): void {
  if (currentGoal) {
    currentGoal.executionPlan = steps
    currentGoal.currentStep = 0
    currentGoal.completedSteps = []
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Mark a step as completed and advance to the next step.
 */
export function markStepCompleted(stepIndex: number): void {
  if (currentGoal) {
    if (!currentGoal.completedSteps) {
      currentGoal.completedSteps = []
    }
    if (!currentGoal.completedSteps.includes(stepIndex)) {
      currentGoal.completedSteps.push(stepIndex)
    }
    // Advance to next incomplete step
    if (currentGoal.executionPlan) {
      for (let i = 0; i < currentGoal.executionPlan.length; i++) {
        if (!currentGoal.completedSteps.includes(i)) {
          currentGoal.currentStep = i
          break
        }
      }
    }
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get the current execution progress as a formatted string.
 */
export function getExecutionProgress(): string | null {
  if (!currentGoal?.executionPlan) return null

  const steps = currentGoal.executionPlan
  const completed = currentGoal.completedSteps || []
  const failed = currentGoal.failedSteps || []
  const current = currentGoal.currentStep || 0

  return steps.map((step, i) => {
    let status = '[ ]'
    if (completed.includes(i)) status = '[x]'
    else if (failed.includes(i)) status = '[!]'
    else if (i === current) status = '[>]'
    return `${status} ${step}`
  }).join('\n')
}

/**
 * Record a step failure for retry tracking.
 */
export function recordStepFailure(stepIndex: number, error: string): void {
  if (currentGoal) {
    if (!currentGoal.failedSteps) {
      currentGoal.failedSteps = []
    }
    if (!currentGoal.failedSteps.includes(stepIndex)) {
      currentGoal.failedSteps.push(stepIndex)
    }
    currentGoal.lastError = error
    currentGoal.retryCount = (currentGoal.retryCount || 0) + 1
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Clear failure status for a step (after successful retry).
 */
export function clearStepFailure(stepIndex: number): void {
  if (currentGoal?.failedSteps) {
    currentGoal.failedSteps = currentGoal.failedSteps.filter(i => i !== stepIndex)
    currentGoal.retryCount = 0
    currentGoal.lastError = undefined
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get error recovery suggestions based on current state.
 */
export function getErrorRecoveryHint(): string | null {
  if (!currentGoal?.lastError) return null

  const retryCount = currentGoal.retryCount || 0
  if (retryCount >= 3) {
    return 'Multiple failures detected. Consider: (1) trying a completely different approach, (2) breaking this step into smaller steps, or (3) skipping this step and moving to the next one.'
  }
  return `Previous error: ${currentGoal.lastError}. Try an alternative approach.`
}

// ============ Self-Reflection Mechanism ============

/**
 * Initialize reflection settings for a goal.
 */
export function initReflection(interval?: number): void {
  if (currentGoal) {
    currentGoal.reflectionInterval = interval ?? DEFAULT_REFLECTION_INTERVAL
    currentGoal.lastReflectionTurn = 0
    currentGoal.reflections = []
    currentGoal.strategyChanges = []
  }
}

/**
 * Check if reflection is needed at the current turn.
 */
export function shouldReflect(): boolean {
  if (!currentGoal?.reflectionInterval) return false
  const lastReflection = currentGoal.lastReflectionTurn || 0
  return currentGoal.turnsUsed > 0 &&
    currentGoal.turnsUsed - lastReflection >= currentGoal.reflectionInterval
}

/**
 * Record a reflection and update the last reflection turn.
 */
export function recordReflection(reflection: string): void {
  if (currentGoal) {
    if (!currentGoal.reflections) {
      currentGoal.reflections = []
    }
    currentGoal.reflections.push(`[Turn ${currentGoal.turnsUsed}] ${reflection}`)
    currentGoal.lastReflectionTurn = currentGoal.turnsUsed
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Record a strategy change based on reflection.
 */
export function recordStrategyChange(change: string): void {
  if (currentGoal) {
    if (!currentGoal.strategyChanges) {
      currentGoal.strategyChanges = []
    }
    currentGoal.strategyChanges.push(`[Turn ${currentGoal.turnsUsed}] ${change}`)
    currentGoal.updatedAt = Date.now()
  }
}

// ============ Subtask Decomposition ============

function generateSubtaskId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Decompose the goal into subtasks.
 */
export function setSubtasks(descriptions: string[]): void {
  if (currentGoal) {
    currentGoal.subtasks = descriptions.map((desc, i) => ({
      id: generateSubtaskId(),
      description: desc,
      status: 'pending' as const,
      dependencies: i > 0 ? [i - 1] : undefined,
    }))
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get the next pending subtask that has all dependencies met.
 */
export function getNextSubtask(): Subtask | null {
  if (!currentGoal?.subtasks) return null

  for (const subtask of currentGoal.subtasks) {
    if (subtask.status !== 'pending') continue

    // Check if all dependencies are completed
    if (subtask.dependencies) {
      const allDepsCompleted = subtask.dependencies.every(
        depIndex => currentGoal!.subtasks![depIndex]?.status === 'completed'
      )
      if (!allDepsCompleted) continue
    }

    return subtask
  }
  return null
}

/**
 * Update subtask status.
 */
export function updateSubtaskStatus(
  subtaskIndex: number,
  status: Subtask['status'],
  result?: string
): void {
  if (currentGoal?.subtasks?.[subtaskIndex]) {
    currentGoal.subtasks[subtaskIndex].status = status
    if (result) {
      currentGoal.subtasks[subtaskIndex].result = result
    }
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get subtask progress as formatted string.
 */
export function getSubtaskProgress(): string | null {
  if (!currentGoal?.subtasks?.length) return null

  const statusEmoji = {
    pending: '[ ]',
    in_progress: '[>]',
    completed: '[x]',
    failed: '[!]',
  }

  return currentGoal.subtasks.map((st, i) => {
    return `${statusEmoji[st.status]} ${st.description}`
  }).join('\n')
}

// ============ Context Compression ============

/**
 * Record a context compression event.
 */
export function recordCompact(summary: string): void {
  if (currentGoal) {
    currentGoal.compactCount = (currentGoal.compactCount || 0) + 1
    currentGoal.lastCompactTurn = currentGoal.turnsUsed
    if (!currentGoal.compactSummaries) {
      currentGoal.compactSummaries = []
    }
    currentGoal.compactSummaries.push(`[Turn ${currentGoal.turnsUsed}] ${summary}`)
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get context compression status for display.
 */
export function getCompactStatus(): string | null {
  if (!currentGoal?.compactCount) return null
  return `Context compacted ${currentGoal.compactCount} times (last at turn ${currentGoal.lastCompactTurn})`
}

/**
 * Get a condensed summary of goal state for context window optimization.
 * This can be injected when context is getting large.
 */
export function getGoalSummary(): string {
  if (!currentGoal) return ''

  const parts = [`Goal: ${currentGoal.objective}`]

  if (currentGoal.executionPlan) {
    const completed = currentGoal.completedSteps?.length || 0
    const total = currentGoal.executionPlan.length
    parts.push(`Progress: ${completed}/${total} steps completed`)
  }

  if (currentGoal.subtasks) {
    const completed = currentGoal.subtasks.filter(s => s.status === 'completed').length
    parts.push(`Subtasks: ${completed}/${currentGoal.subtasks.length} done`)
  }

  if (currentGoal.lastError) {
    parts.push(`Last error: ${currentGoal.lastError}`)
  }

  return parts.join(' | ')
}

/**
 * Get the reflection prompt to inject into continuation.
 */
export function getReflectionPrompt(): string | null {
  if (!shouldReflect()) return null

  const completedCount = currentGoal?.completedSteps?.length || 0
  const failedCount = currentGoal?.failedSteps?.length || 0
  const totalSteps = currentGoal?.executionPlan?.length || 0

  return `<reflection>SELF-REFLECTION REQUIRED (Turn ${currentGoal?.turnsUsed}):

Evaluate your progress and strategy:
1. Progress: ${completedCount}/${totalSteps} steps completed, ${failedCount} failed
2. Are you making meaningful progress toward the goal?
3. Is your current approach effective? Should you change strategy?
4. Are there any blockers you need to address differently?

If you need to change strategy, explain what and why. Then proceed with the adjusted approach.</reflection>`
}

export function getGoalDurationMs(): number {
  if (!currentGoal) return 0
  return Date.now() - currentGoal.startedAt
}

/**
 * Serialize goal state for potential persistence.
 * Returns null if no goal is active.
 */
export function serializeGoal(): string | null {
  if (!currentGoal) return null
  return JSON.stringify(currentGoal)
}

export function isConditionMode(): boolean {
  return currentGoal?.mode === 'condition'
}

export function getGoalCondition(): string | undefined {
  return currentGoal?.condition
}

/**
 * Deserialize and restore goal state.
 * Returns true if restoration was successful.
 *
 * On resume: resets turnsUsed and startedAt to give the goal a fresh start,
 * matching Claude Code's behavior where turn count and timer reset on resume.
 */
export function deserializeGoal(serialized: string): boolean {
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!parsed || typeof parsed !== 'object') return false

    const p = parsed as Record<string, unknown>

    // Validate required fields with strict type checking
    if (typeof p.id !== 'string' || !p.id) return false
    if (typeof p.objective !== 'string' || !p.objective.trim()) return false
    if (typeof p.status !== 'string' || !['active', 'paused', 'budget_limited', 'complete'].includes(p.status)) return false
    if (typeof p.maxTurns !== 'number' || !Number.isFinite(p.maxTurns)) return false
    if (typeof p.turnsUsed !== 'number' || !Number.isFinite(p.turnsUsed)) return false
    if (typeof p.createdAt !== 'number') return false
    if (typeof p.updatedAt !== 'number') return false
    if (typeof p.mode !== 'string' || !['objective', 'condition'].includes(p.mode)) return false
    if (typeof p.tokensSpent !== 'number') return false
    if (typeof p.startedAt !== 'number') return false

    // Reconstruct with validated fields to prevent prototype pollution
    // Counters are reset on resume (per Claude Code behavior)
    currentGoal = {
      id: p.id,
      objective: p.objective.trim(),
      status: p.status as GoalStatus,
      maxTurns: clampMaxTurns(p.maxTurns),
      turnsUsed: 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      mode: p.mode as GoalMode,
      condition: typeof p.condition === 'string' ? p.condition.trim() : undefined,
      evaluatorReason: undefined,
      tokensSpent: 0,
      startedAt: Date.now(), // Reset timer on resume
    }

    consecutiveZeroToolCalls = 0
    return true
  } catch {
    // Invalid serialized data
  }
  return false
}
