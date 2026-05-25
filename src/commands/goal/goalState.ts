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
}

// Session-scoped goal state
let currentGoal: Goal | null = null

// Track consecutive turns without tool calls (continuation suppression)
let consecutiveZeroToolCalls = 0
const MAX_ZERO_TOOL_CALLS = 3

// Minimum and maximum allowed turns
const MIN_TURNS = 1
const MAX_TURNS = 100

function generateGoalId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function clampMaxTurns(maxTurns: number): number {
  if (!Number.isFinite(maxTurns)) {
    return 10 // sensible default
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
  const conditionPatterns = [
    /\bpass\b/, /\bpasses\b/,
    /\bexit\b/, /\bexit code\b/, /\bexit 0\b/,
    /\bclean\b/, /\bno errors\b/, /\bno failures\b/,
    /\ball\b/, /\bevery\b/, /\beach\b/, /\bnone\b/,
    /\bcompiles\b/, /\bbuilds\b/, /\blint\b/,
    /\btest\b/, /\btests\b/, /\bcoverage\b/,
    /\bgit status\b/, /\bdiff\b/, /\breview\b/,
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
    sessionStorageModule().then(m => m.saveGoalState(serialized)).catch(() => {
      // Silently ignore persistence errors
    })
  } catch {
    // Ignore persistence errors
  }
}

export function setGoal(objective: string, maxTurns: number = 10): Goal {
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
