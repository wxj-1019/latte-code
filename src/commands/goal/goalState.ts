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

// Shared lazy-loaded filesystem modules (avoids repeated dynamic imports)
const fsModules = {
  fs: null as typeof import('fs/promises') | null,
  path: null as typeof import('path') | null,
  os: null as typeof import('os') | null,
}

async function getFsModules() {
  if (!fsModules.fs) {
    const [fs, path, os] = await Promise.all([
      import('fs/promises'),
      import('path'),
      import('os'),
    ])
    fsModules.fs = fs
    fsModules.path = path
    fsModules.os = os
  }
  return fsModules as { fs: typeof import('fs/promises'); path: typeof import('path'); os: typeof import('os') }
}

export type GoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export type GoalMode = 'objective' | 'condition'

// ============ Enterprise Features: Audit Logging ============

export type AuditAction = 'created' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cleared' | 'budget_exhausted' | 'strategy_changed'

export interface AuditLogEntry {
  timestamp: number
  action: AuditAction
  goalId: string
  objective: string
  userId?: string
  metadata?: Record<string, unknown>
  turnNumber?: number
}

const auditLog: AuditLogEntry[] = []

function addAuditEntry(action: AuditAction, metadata?: Record<string, unknown>): void {
  if (!currentGoal) return

  const entry: AuditLogEntry = {
    timestamp: Date.now(),
    action,
    goalId: currentGoal.id,
    objective: currentGoal.objective,
    turnNumber: currentGoal.turnsUsed,
    metadata,
  }

  auditLog.push(entry)

  // Keep only last 100 entries to prevent memory leaks
  if (auditLog.length > 100) {
    auditLog.splice(0, auditLog.length - 100)
  }

  // Trigger webhook for matching events
  triggerWebhook(entry)
}

export function getAuditLog(): AuditLogEntry[] {
  return [...auditLog]
}

export function getAuditLogForGoal(goalId: string): AuditLogEntry[] {
  return auditLog.filter(entry => entry.goalId === goalId)
}

/**
 * Clear audit log (for testing).
 */
export function clearAuditLog(): void {
  auditLog.length = 0
}

/**
 * Reset metrics (for testing).
 */
export function resetMetrics(): void {
  metrics.totalGoalsCreated = 0
  metrics.totalGoalsCompleted = 0
  metrics.totalGoalsFailed = 0
  metrics.totalTurnsUsed = 0
  metrics.totalDurationMs = 0
}

// ============ Enterprise Features: Metrics Collection ============

export interface GoalMetrics {
  totalGoalsCreated: number
  totalGoalsCompleted: number
  totalGoalsFailed: number
  totalTurnsUsed: number
  averageTurnsPerGoal: number
  averageDurationMs: number
  successRate: number
}

const metrics = {
  totalGoalsCreated: 0,
  totalGoalsCompleted: 0,
  totalGoalsFailed: 0,
  totalTurnsUsed: 0,
  totalDurationMs: 0,
}

export function getGoalMetrics(): GoalMetrics {
  const averageTurnsPerGoal = metrics.totalGoalsCreated > 0
    ? metrics.totalTurnsUsed / metrics.totalGoalsCreated
    : 0

  const averageDurationMs = metrics.totalGoalsCreated > 0
    ? metrics.totalDurationMs / metrics.totalGoalsCreated
    : 0

  const successRate = metrics.totalGoalsCreated > 0
    ? (metrics.totalGoalsCompleted / metrics.totalGoalsCreated) * 100
    : 0

  return {
    totalGoalsCreated: metrics.totalGoalsCreated,
    totalGoalsCompleted: metrics.totalGoalsCompleted,
    totalGoalsFailed: metrics.totalGoalsFailed,
    totalTurnsUsed: metrics.totalTurnsUsed,
    averageTurnsPerGoal: Math.round(averageTurnsPerGoal * 100) / 100,
    averageDurationMs: Math.round(averageDurationMs),
    successRate: Math.round(successRate * 100) / 100,
  }
}

// ============ Enterprise Features: Progress Persistence ============

interface PersistedGoalState {
  goal: Goal
  auditLog: AuditLogEntry[]
  metrics: typeof metrics
  persistedAt: number
}

const PERSISTENCE_KEY = 'goal_persistence'

function getGoalPersistenceDir(path: typeof import('path'), os: typeof import('os')): string {
  const configDir = process.env.LATTE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR
  if (configDir) {
    return path.join(configDir, 'goal-persistence')
  }
  return path.join(os.homedir(), '.claude', 'goal-persistence')
}

async function persistGoalStateToDisk(): Promise<void> {
  try {
    const state: PersistedGoalState = {
      goal: currentGoal!,
      auditLog: auditLog.slice(-50), // Keep last 50 entries
      metrics,
      persistedAt: Date.now(),
    }

    const serialized = JSON.stringify(state)
    const { fs, path, os } = await getFsModules()

    const persistDir = getGoalPersistenceDir(path, os)
    await fs.mkdir(persistDir, { recursive: true })

    const persistFile = path.join(persistDir, `${PERSISTENCE_KEY}.json`)
    await fs.writeFile(persistFile, serialized, 'utf-8')
  } catch (error) {
    // Silently ignore persistence errors to not break goal execution
    logForDebugging(`Failed to persist goal state: ${error}`)
  }
}

export async function loadGoalStateFromDisk(): Promise<boolean> {
  try {
    const { fs, path, os } = await getFsModules()

    const persistFile = path.join(getGoalPersistenceDir(path, os), `${PERSISTENCE_KEY}.json`)
    const data = await fs.readFile(persistFile, 'utf-8')
    const state: PersistedGoalState = JSON.parse(data)

    if (state.goal && typeof state.goal.id === 'string' && typeof state.goal.objective === 'string') {
      // Validate required fields to prevent corrupted data from breaking the system
      const g = state.goal
      if (!['active', 'paused', 'budget_limited', 'complete'].includes(g.status)) return false
      if (typeof g.maxTurns !== 'number' || !Number.isFinite(g.maxTurns)) return false

      currentGoal = g
      auditLog.length = 0
      auditLog.push(...(state.auditLog || []))

      if (state.metrics) {
        metrics.totalGoalsCreated = state.metrics.totalGoalsCreated || 0
        metrics.totalGoalsCompleted = state.metrics.totalGoalsCompleted || 0
        metrics.totalGoalsFailed = state.metrics.totalGoalsFailed || 0
        metrics.totalTurnsUsed = state.metrics.totalTurnsUsed || 0
        metrics.totalDurationMs = state.metrics.totalDurationMs || 0
      }

      return true
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return false
}

// ============ Enterprise Features: Webhook Support ============

export interface WebhookConfig {
  url: string
  events: AuditAction[]
  secret?: string
}

let webhookConfig: WebhookConfig | null = null

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Only allow https to prevent SSRF via file://, gopher://, etc.
    if (parsed.protocol !== 'https:') return false
    // Block loopback and private network addresses
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.')
    ) return false
    return true
  } catch {
    return false
  }
}

export function setWebhookConfig(config: WebhookConfig | null): void {
  if (config && !isValidWebhookUrl(config.url)) {
    throw new Error(
      `Invalid webhook URL: ${config.url}. Only https:// URLs to public hosts are allowed.`,
    )
  }
  webhookConfig = config
}

export function getWebhookConfig(): WebhookConfig | null {
  return webhookConfig
}

async function triggerWebhook(entry: AuditLogEntry): Promise<void> {
  if (!webhookConfig) return
  if (!webhookConfig.events.includes(entry.action)) return

  try {
    const payload = JSON.stringify({
      event: entry.action,
      goalId: entry.goalId,
      objective: entry.objective,
      timestamp: entry.timestamp,
      turnNumber: entry.turnNumber,
      metadata: entry.metadata,
    })

    // Fire and forget with timeout - don't block goal execution
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch(webhookConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookConfig.secret ? { 'X-Webhook-Secret': webhookConfig.secret } : {}),
      },
      body: payload,
      signal: controller.signal,
    }).catch(() => {
      // Silently ignore webhook failures
    }).finally(() => clearTimeout(timeout))
  } catch {
    // Silently ignore webhook errors
  }
}

// Helper for debug logging (outputs to stderr in debug mode)
function logForDebugging(message: string): void {
  if (process.env.DEBUG || process.env.GOAL_DEBUG) {
    process.stderr.write(`[goal] ${message}\n`)
  }
}

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
  // Episodic memory (Reflexion pattern)
  episodicMemory?: EpisodicMemoryEntry[]
  // Adaptive re-planning
  replanCount?: number
  lastReplanTurn?: number
  replanTriggers?: string[] // 记录触发重规划的原因
  // Skill library (Voyager pattern)
  skillLibrary?: SkillEntry[]
  // Auto-verification
  verification?: VerificationConfig
  verificationResults?: VerificationResult[]
  // Token budget (cost guardrails)
  budgetConfig?: BudgetConfig
}

export type Subtask = {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependencies?: number[] //依赖的子任务索引
  result?: string //执行结果
  priority?: number // 优先级 (1=高, 2=中, 3=低)
  canParallel?: boolean // 是否可以与其他任务并行执行
  startedAt?: number // 开始执行时间
  completedAt?: number // 完成时间
}

// ============ Episodic Memory (Reflexion Pattern) ============

export type EpisodeOutcome = 'success' | 'failure' | 'partial'

export interface EpisodicMemoryEntry {
  turn: number
  stepIndex?: number
  action: string        // 尝试了什么
  outcome: EpisodeOutcome
  error?: string        // 失败时的错误信息
  reflection: string    // 为什么失败/成功
  lesson: string        // 可复用的经验教训
  timestamp: number
  importanceScore: number  // 基于 error severity + retryCount 计算（1-10）
}

// ============ Skill Library (Voyager Pattern) ============

export interface SkillEntry {
  id: string
  name: string
  description: string
  code?: string         // 相关代码片段
  context: string       // 使用场景
  successCount: number
  failureCount: number
  lastUsedTurn: number
  tags: string[]
  successWindow: boolean[]  // 最近 10 次使用记录（用于淘汰判定）
  deprecated: boolean
  deprecatedReason?: string
}

// ============ Auto-Verification ============

export interface VerificationConfig {
  commands: string[]    // 如 ["npm test", "tsc --noEmit"]
  maxRetries: number
  timeoutMs: number
}

export interface VerificationResult {
  passed: boolean
  command: string
  exitCode: number
  stdout: string
  stderr: string
  timestamp: number
}

// ============ Token Budget (Cost Guardrails) ============

export interface BudgetConfig {
  maxTokensTotal?: number      // 累计 token 上限
  maxTokensPerTurn?: number    // 单轮上限
  maxCostUSD?: number          // 基于模型定价的估算成本上限
  warningThresholds: {
    tokens: number[]           // token 使用百分比告警阈值
    cost: number[]             // 成本百分比告警阈值
  }
}

// Session-scoped goal state
let currentGoal: Goal | null = null

// Track the original permission mode before goal was set (for restoration)
let originalPermissionMode: string | null = null

// Track consecutive turns without tool calls (continuation suppression)
let consecutiveZeroToolCalls = 0
const MAX_ZERO_TOOL_CALLS = parseEnvInt('GOAL_MAX_ZERO_TOOL_CALLS', 5)

// Track if completion signal has been sent to prevent repeated signaling
let completionSignalSent = false

// Cooldown mechanism for reflections (prevent rapid consecutive reflections)
let lastReflectionTimestamp = 0
const REFLECTION_COOLDOWN_MS = parseEnvInt('GOAL_REFLECTION_COOLDOWN_MS', 2000)

// Minimum and maximum allowed turns
const MIN_TURNS = 1
const MAX_TURNS = parseEnvInt('GOAL_MAX_TURNS_LIMIT', 500)

// Wall-clock timeout (minutes) — goal auto-terminates after this duration
const MAX_DURATION_MINUTES = parseEnvInt('GOAL_MAX_DURATION_MINUTES', 0) // 0 = disabled
// Token budget — goal auto-terminates when tokens exceed this limit
const MAX_TOKEN_BUDGET = parseEnvInt('GOAL_MAX_TOKENS', 0) // 0 = disabled

// Default reflection interval (configurable via env)
const DEFAULT_REFLECTION_INTERVAL = parseEnvInt('GOAL_REFLECTION_INTERVAL', 5)

// Resource warning thresholds (used in goalPrompts.ts via getGoalConfig)
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
    reflectionCooldownMs: String(REFLECTION_COOLDOWN_MS),
    resourceWarning60: String(RESOURCE_WARNING_60),
    resourceWarning80: String(RESOURCE_WARNING_80),
    env_GOAL_MAX_TURNS: process.env.GOAL_MAX_TURNS || 'not set',
    env_GOAL_MAX_TURNS_LIMIT: process.env.GOAL_MAX_TURNS_LIMIT || 'not set',
    env_GOAL_MAX_ZERO_TOOL_CALLS: process.env.GOAL_MAX_ZERO_TOOL_CALLS || 'not set',
    env_GOAL_REFLECTION_INTERVAL: process.env.GOAL_REFLECTION_INTERVAL || 'not set',
    env_GOAL_REFLECTION_COOLDOWN_MS: process.env.GOAL_REFLECTION_COOLDOWN_MS || 'not set',
  }
}

/**
 * Check if completion signal has already been sent.
 * This prevents repeated [GOAL_COMPLETED] output and token waste.
 */
export function isCompletionSignalSent(): boolean {
  return completionSignalSent
}

/**
 * Mark that completion signal has been sent.
 * Called when [GOAL_COMPLETED] is detected in model output.
 */
export function markCompletionSignalSent(): void {
  completionSignalSent = true
}

/**
 * Reset completion signal (for new goals).
 */
export function resetCompletionSignal(): void {
  completionSignalSent = false
}

/**
 * Check if reflection is allowed based on cooldown.
 * Prevents rapid consecutive reflections that waste tokens.
 */
export function isReflectionCooldownActive(): boolean {
  const now = Date.now()
  return now - lastReflectionTimestamp < REFLECTION_COOLDOWN_MS
}

/**
 * Update reflection timestamp (called after reflection is recorded).
 */
export function updateReflectionTimestamp(): void {
  lastReflectionTimestamp = Date.now()
}

/**
 * Reset reflection cooldown (for testing).
 */
export function resetReflectionCooldown(): void {
  lastReflectionTimestamp = 0
}

function generateGoalId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isVerificationConfig(val: unknown): val is VerificationConfig {
  if (!val || typeof val !== 'object') return false
  const v = val as Record<string, unknown>
  return Array.isArray(v.commands) && typeof v.maxRetries === 'number' && typeof v.timeoutMs === 'number'
}

function isBudgetConfig(val: unknown): val is BudgetConfig {
  if (!val || typeof val !== 'object') return false
  const v = val as Record<string, unknown>
  return v.warningThresholds !== undefined && typeof v.warningThresholds === 'object'
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

      // Enterprise: Also persist to disk for durability
      persistGoalStateToDisk().catch(() => {})
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

  // Reset completion signal for new goal
  resetCompletionSignal()

  // Enterprise: Increment metrics and add audit entry
  metrics.totalGoalsCreated++
  addAuditEntry('created', { maxTurns: clampedMaxTurns, mode, condition })

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
    addAuditEntry('paused')
  }
}

export function resumeGoal(): void {
  if (currentGoal && currentGoal.status === 'paused') {
    currentGoal.status = 'active'
    currentGoal.updatedAt = Date.now()
    addAuditEntry('resumed')
  }
}

export function clearGoal(): void {
  if (currentGoal) {
    addAuditEntry('cleared', { reason: 'manually_cleared' })
  }
  currentGoal = null
  consecutiveZeroToolCalls = 0
  resetCompletionSignal()
  persistGoalState()
}

export function getOriginalPermissionMode(): string | null {
  return originalPermissionMode
}

export function setOriginalPermissionMode(mode: string | null): void {
  originalPermissionMode = mode
}

type SetAppStateFn = (updater: (prev: { toolPermissionContext: { mode: string } }) => { toolPermissionContext: { mode: string } }) => void

/**
 * Restore the original permission mode that was active before the goal was set.
 * Shared by both goal.ts (command handler) and query.ts (query loop).
 */
export function restoreOriginalPermissionMode(setAppState: SetAppStateFn): void {
  const originalMode = getOriginalPermissionMode()
  if (originalMode) {
    setAppState(prev => ({
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

    // Enterprise: Update metrics and add audit entry
    metrics.totalGoalsCompleted++
    metrics.totalTurnsUsed += currentGoal.turnsUsed
    metrics.totalDurationMs += Date.now() - currentGoal.startedAt
    addAuditEntry('completed', {
      turnsUsed: currentGoal.turnsUsed,
      tokensSpent: currentGoal.tokensSpent,
      durationMs: Date.now() - currentGoal.startedAt,
    })

    persistGoalState()
  }
}

export function markGoalBudgetLimited(): void {
  if (currentGoal) {
    currentGoal.status = 'budget_limited'
    currentGoal.updatedAt = Date.now()

    // Enterprise: Update metrics and add audit entry
    metrics.totalGoalsFailed++
    metrics.totalTurnsUsed += currentGoal.turnsUsed
    metrics.totalDurationMs += Date.now() - currentGoal.startedAt
    addAuditEntry('budget_exhausted', {
      turnsUsed: currentGoal.turnsUsed,
      maxTurns: currentGoal.maxTurns,
    })

    persistGoalState()
  }
}

export function incrementTurn(): void {
  if (currentGoal) {
    currentGoal.turnsUsed++
    currentGoal.updatedAt = Date.now()

    // Enterprise: Periodically persist state to disk (every 5 turns)
    if (currentGoal.turnsUsed % 5 === 0) {
      persistGoalStateToDisk().catch(() => {})
    }
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

/**
 * Check if the goal has exceeded its wall-clock duration limit.
 * Returns reason string if exceeded, null otherwise.
 */
export function checkGoalDuration(): string | null {
  if (MAX_DURATION_MINUTES <= 0 || !currentGoal) return null
  const elapsed = (Date.now() - currentGoal.startedAt) / 60000
  if (elapsed >= MAX_DURATION_MINUTES) {
    return `Duration limit exceeded: ${Math.ceil(elapsed)}min / ${MAX_DURATION_MINUTES}min`
  }
  return null
}

/**
 * Check if the goal has exceeded its token budget.
 * Returns reason string if exceeded, null otherwise.
 */
export function checkGoalTokenBudget(): string | null {
  if (MAX_TOKEN_BUDGET <= 0 || !currentGoal) return null
  if (currentGoal.tokensSpent >= MAX_TOKEN_BUDGET) {
    return `Token budget exceeded: ${currentGoal.tokensSpent} / ${MAX_TOKEN_BUDGET}`
  }
  return null
}

/**
 * Smart Approvals guardian check during goal execution.
 * Evaluates tool operations for safety patterns during autonomous execution.
 * Returns { block, warn, reason } — a post-execution feedback decision.
 *
 * Called from query.ts goal hooks to flag dangerous operations
 * so the model can adapt its approach on the next turn.
 */
export function getGoalGuardianDecision(
  toolName: string,
  operationDescription: string,
): { block: boolean; warn: boolean; reason: string } {
  // Whitelist: always-safe tools during goal execution
  const goalSafeTools = new Set([
    'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch',
    'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
    'LSP', 'ListMcpResources', 'TodoWrite',
  ])

  if (goalSafeTools.has(toolName)) {
    return { block: false, warn: false, reason: 'safe tool' }
  }

  // Dangerous patterns that should be blocked during autonomous execution
  const description = operationDescription.toLowerCase()
  const dangerousPatterns: Array<[RegExp, string]> = [
    [/rm\s+-rf\s+\//, 'filesystem destruction'],
    [/sudo\b/, 'privilege escalation'],
    [/>\s*\/dev\/(sda|nvme)/, 'raw device write'],
    [/(curl|wget).*\|.*(ba)?sh/, 'pipe-to-shell'],
    [/chmod\s+777/, 'insecure permissions'],
    [/mkfs\./, 'filesystem formatting'],
  ]

  for (const [pattern, reason] of dangerousPatterns) {
    if (pattern.test(description)) {
      return {
        block: true,
        warn: false,
        reason: `Auto-blocked: ${reason} — "${operationDescription.slice(0, 80)}"`,
      }
    }
  }

  // For Write/Edit outside workspace — warn but don't block
  if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash') &&
      (description.includes('/etc/') ||
       description.includes('/usr/') ||
       description.includes('/System/') ||
       description.includes('/var/log'))) {
    return {
      block: false,
      warn: true,
      reason: `WARNING: Operation outside workspace — "${operationDescription.slice(0, 80)}"`,
    }
  }

  return { block: false, warn: false, reason: 'allowed' }
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

  // Verification status
  const verificationStr = getVerificationStatus() ? `\n  ${getVerificationStatus()}` : ''

  // Budget status
  const budgetStr = getBudgetStatus() ? `\n  ${getBudgetStatus()}` : ''

  return `[${statusEmoji}] Goal: ${objective}${modeStr}\n  Status: ${status} | ${turnsUsed}/${maxTurns} turns${progressBar} | ${duration}${tokenStr}${reasonStr}${verificationStr}${budgetStr}`
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

    // Enterprise: Add audit entry for step failure
    addAuditEntry('failed', {
      reason: 'step_failure',
      stepIndex,
      error,
      retryCount: currentGoal.retryCount,
    })
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
 * Now includes cooldown mechanism to prevent rapid consecutive reflections.
 */
export function shouldReflect(): boolean {
  if (!currentGoal?.reflectionInterval) return false
  if (isCompletionSignalSent()) return false
  if (isReflectionCooldownActive()) return false

  const lastReflection = currentGoal.lastReflectionTurn || 0
  return currentGoal.turnsUsed > 0 &&
    currentGoal.turnsUsed - lastReflection >= currentGoal.reflectionInterval
}

/**
 * Record a reflection and update the last reflection turn.
 * Now updates reflection timestamp for cooldown mechanism.
 */
export function recordReflection(reflection: string): void {
  if (currentGoal) {
    if (!currentGoal.reflections) {
      currentGoal.reflections = []
    }
    currentGoal.reflections.push(`[Turn ${currentGoal.turnsUsed}] ${reflection}`)
    // Keep bounded — max 50 reflections
    if (currentGoal.reflections.length > 50) {
      currentGoal.reflections = currentGoal.reflections.slice(-50)
    }
    currentGoal.lastReflectionTurn = currentGoal.turnsUsed
    currentGoal.updatedAt = Date.now()
    updateReflectionTimestamp()
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
    // Keep bounded — max 30 strategy changes
    if (currentGoal.strategyChanges.length > 30) {
      currentGoal.strategyChanges = currentGoal.strategyChanges.slice(-30)
    }
    currentGoal.updatedAt = Date.now()

    // Enterprise: Add audit entry for strategy change
    addAuditEntry('strategy_changed', { change, turn: currentGoal.turnsUsed })
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

  const ready = currentGoal.subtasks.filter(subtask => {
    if (subtask.status !== 'pending') return false
    if (!subtask.dependencies) return true
    return subtask.dependencies.every(
      depIndex => currentGoal!.subtasks![depIndex]?.status === 'completed'
    )
  })

  if (!ready.length) return null

  // Sort by priority (lower number = higher priority)
  ready.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
  return ready[0]
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
    const subtask = currentGoal.subtasks[subtaskIndex]
    subtask.status = status
    if (result) {
      subtask.result = result
    }
    if (status === 'in_progress' && !subtask.startedAt) {
      subtask.startedAt = Date.now()
    }
    if (status === 'completed' || status === 'failed') {
      subtask.completedAt = Date.now()
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

// ============ Episodic Memory (Reflexion Pattern) ============

const MAX_EPISODES = 20

/**
 * Calculate importance score for an episodic memory entry.
 * Higher score = more important to keep.
 * Factors: outcome severity, retry count, error presence.
 */
function calculateImportanceScore(entry: { outcome: EpisodeOutcome; error?: string; retryCount?: number }): number {
  let score = 5 // baseline

  // Failures are more important to remember than successes
  if (entry.outcome === 'failure') score += 3
  else if (entry.outcome === 'partial') score += 1

  // Errors with specific messages are more informative
  if (entry.error && entry.error.length > 10) score += 1

  // Retries indicate a persistent problem worth remembering
  if ((entry.retryCount ?? 0) >= 3) score += 1

  return Math.min(10, Math.max(1, score))
}

/**
 * Record an episode (action + outcome + lesson) for future reference.
 * Based on Reflexion: Language Agents with Verbal Reinforcement Learning.
 *
 * Now includes importance-based eviction: when the memory is full,
 * the entry with the lowest importanceScore is evicted instead of the oldest.
 */
export function recordEpisode(entry: Omit<EpisodicMemoryEntry, 'timestamp' | 'importanceScore'>): void {
  if (!currentGoal) return
  if (!currentGoal.episodicMemory) currentGoal.episodicMemory = []

  const importanceScore = calculateImportanceScore(entry)

  currentGoal.episodicMemory.push({
    ...entry,
    timestamp: Date.now(),
    importanceScore,
  })

  // Smart eviction: remove lowest importance entry when over limit
  if (currentGoal.episodicMemory.length > MAX_EPISODES) {
    // Find the entry with the lowest importance score (prefer evicting low-value memories)
    let minIdx = 0
    let minScore = currentGoal.episodicMemory[0].importanceScore
    for (let i = 1; i < currentGoal.episodicMemory.length; i++) {
      const s = currentGoal.episodicMemory[i].importanceScore
      if (s < minScore) {
        minScore = s
        minIdx = i
      }
    }
    currentGoal.episodicMemory.splice(minIdx, 1)
  }

  currentGoal.updatedAt = Date.now()
}

/**
 * Get relevant lessons from past failures to inject into prompts.
 * Prioritizes by importanceScore (high-importance lessons first),
 * then by recency as tiebreaker.
 */
export function getRelevantLessons(maxLessons: number = 3): string | null {
  if (!currentGoal?.episodicMemory?.length) return null

  const failures = currentGoal.episodicMemory.filter(e => e.outcome === 'failure')
  if (!failures.length) return null

  // Sort by importanceScore desc, then by turn desc (most recent first)
  const sorted = [...failures].sort((a, b) => {
    if (a.importanceScore !== b.importanceScore) return b.importanceScore - a.importanceScore
    return b.turn - a.turn
  })

  return sorted.slice(0, maxLessons).map(e =>
    `- [Turn ${e.turn}] "${e.action}" failed: ${e.error || 'unknown error'}. Lesson: ${e.lesson}`
  ).join('\n')
}

/**
 * Get a summary of episodic memory for status display.
 */
export function getEpisodicSummary(): string | null {
  if (!currentGoal?.episodicMemory?.length) return null

  const total = currentGoal.episodicMemory.length
  const successes = currentGoal.episodicMemory.filter(e => e.outcome === 'success').length
  const failures = currentGoal.episodicMemory.filter(e => e.outcome === 'failure').length

  return `Episodes: ${total} total (${successes} success, ${failures} failed)`
}

// ============ Adaptive Re-Planning ============

const REPLAN_TURN_THRESHOLD = 0.6  // >60% turns used
const REPLAN_PROGRESS_THRESHOLD = 0.3  // <30% steps done
const REPLAN_FAILED_STEPS_THRESHOLD = 2  // 2+ steps failed

/**
 * Check if the current plan needs to be regenerated.
 * Triggers re-planning when:
 * 1. >60% turns used but <30% steps completed
 * 2. 2+ steps have failed
 * 3. Last error has been retrying for 3+ times
 */
export function shouldReplan(): boolean {
  if (!currentGoal) return false
  if (isCompletionSignalSent()) return false

  const total = currentGoal.executionPlan?.length || 0
  const completed = currentGoal.completedSteps?.length || 0
  const failed = currentGoal.failedSteps?.length || 0

  // Already replanned recently (within 5 turns)
  if (currentGoal.lastReplanTurn && currentGoal.turnsUsed - currentGoal.lastReplanTurn < 5) {
    return false
  }

  // Condition 1: Poor progress relative to turns used
  if (total > 0) {
    const turnRatio = currentGoal.turnsUsed / currentGoal.maxTurns
    const progressRatio = completed / total
    if (turnRatio > REPLAN_TURN_THRESHOLD && progressRatio < REPLAN_PROGRESS_THRESHOLD) {
      return true
    }
  }

  // Condition 2: Too many failed steps
  if (failed >= REPLAN_FAILED_STEPS_THRESHOLD) {
    return true
  }

  // Condition 3: Persistent retry failure
  if ((currentGoal.retryCount || 0) >= 3) {
    return true
  }

  return false
}

/**
 * Record a re-planning event with the reason.
 */
export function recordReplan(reason: string): void {
  if (!currentGoal) return
  currentGoal.replanCount = (currentGoal.replanCount || 0) + 1
  currentGoal.lastReplanTurn = currentGoal.turnsUsed
  if (!currentGoal.replanTriggers) currentGoal.replanTriggers = []
  currentGoal.replanTriggers.push(`[Turn ${currentGoal.turnsUsed}] ${reason}`)
  // Keep bounded — max 20 replan entries
  if (currentGoal.replanTriggers.length > 20) {
    currentGoal.replanTriggers = currentGoal.replanTriggers.slice(-20)
  }
  currentGoal.updatedAt = Date.now()
  addAuditEntry('strategy_changed', { reason: 'replan', trigger: reason })
}

/**
 * Get re-planning prompt to inject into continuation.
 */
export function getReplanPrompt(): string | null {
  if (!shouldReplan()) return null

  const failedSteps = currentGoal?.failedSteps || []
  const failedDescriptions = currentGoal?.executionPlan
    ? failedSteps.map(i => currentGoal!.executionPlan![i]).filter(Boolean)
    : []

  const lessonsBlock = getRelevantLessons(3)
  const lessonsSection = lessonsBlock ? `\nLessons from past failures:\n${lessonsBlock}` : ''

  return `[RE-PLANNING REQUIRED] Current plan is not working effectively.
Failed steps: ${failedDescriptions.length > 0 ? failedDescriptions.join(', ') : 'unknown'}
${lessonsSection}

Generate a NEW, shorter plan:
- Skip steps that have failed 2+ times
- Focus only on the most critical remaining items
- Consider alternative approaches based on lessons learned
- If the goal seems unachievable, output [GOAL_COMPLETED] with a summary`
}

// ============ Skill Library (Voyager Pattern) ============

const MAX_SKILLS = 30

function generateSkillId(): string {
  return `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Record a reusable skill/pattern learned during goal execution.
 * Based on Voyager's skill library concept.
 * Now initializes successWindow and deprecated fields for demotion support.
 */
export function recordSkill(skill: Omit<SkillEntry, 'id' | 'successCount' | 'failureCount' | 'lastUsedTurn' | 'successWindow' | 'deprecated'>): void {
  if (!currentGoal) return
  if (!currentGoal.skillLibrary) currentGoal.skillLibrary = []

  // Check if similar skill already exists
  const existing = currentGoal.skillLibrary.find(s => s.name === skill.name)
  if (existing) {
    existing.successCount++
    existing.lastUsedTurn = currentGoal.turnsUsed
    existing.successWindow.push(true)
    if (existing.successWindow.length > 10) existing.successWindow.shift()
    if (skill.code) existing.code = skill.code
    return
  }

  currentGoal.skillLibrary.push({
    ...skill,
    id: generateSkillId(),
    successCount: 1,
    failureCount: 0,
    lastUsedTurn: currentGoal.turnsUsed,
    successWindow: [true],
    deprecated: false,
  })

  // Keep library bounded — evict deprecated first, then oldest
  if (currentGoal.skillLibrary.length > MAX_SKILLS) {
    const deprecated = currentGoal.skillLibrary.filter(s => s.deprecated)
    if (deprecated.length > 0) {
      // Remove deprecated skills first
      const deprecatedIds = new Set(deprecated.map(s => s.id))
      currentGoal.skillLibrary = currentGoal.skillLibrary.filter(s => !deprecatedIds.has(s.id))
    }
    // If still over limit, remove oldest by lastUsedTurn
    if (currentGoal.skillLibrary.length > MAX_SKILLS) {
      currentGoal.skillLibrary.sort((a, b) => b.lastUsedTurn - a.lastUsedTurn)
      currentGoal.skillLibrary = currentGoal.skillLibrary.slice(0, MAX_SKILLS)
    }
  }

  currentGoal.updatedAt = Date.now()
}

/**
 * Get skills relevant to the current context.
 * Returns skills matching given tags, sorted by success rate.
 */
export function getRelevantSkills(context: string, maxSkills: number = 3): string | null {
  if (!currentGoal?.skillLibrary?.length) return null

  const contextLower = context.toLowerCase()
  const relevant = currentGoal.skillLibrary
    .filter(s => {
      // Exclude deprecated skills
      if (s.deprecated) return false
      // Match by tags or context keywords
      const tagMatch = s.tags.some(t => contextLower.includes(t.toLowerCase()))
      const contextMatch = contextLower.includes(s.context.toLowerCase()) ||
        s.context.toLowerCase().includes(contextLower)
      return tagMatch || contextMatch
    })
    .sort((a, b) => {
      // Sort by success rate, then by recency
      const totalA = a.successCount + a.failureCount
      const totalB = b.successCount + b.failureCount
      const rateA = totalA > 0 ? a.successCount / totalA : 1
      const rateB = totalB > 0 ? b.successCount / totalB : 1
      if (rateA !== rateB) return rateB - rateA
      return b.lastUsedTurn - a.lastUsedTurn
    })
    .slice(0, maxSkills)

  if (!relevant.length) return null

  return relevant.map(s => {
    const total = s.successCount + s.failureCount
    const successRate = total > 0 ? Math.round((s.successCount / total) * 100) : 100
    return `- ${s.name}: ${s.description} (used ${s.successCount}x, ${successRate}% success)`
  }).join('\n')
}

/**
 * Get skill library summary for status display.
 */
export function getSkillLibrarySummary(): string | null {
  if (!currentGoal?.skillLibrary?.length) return null
  return `Skills: ${currentGoal.skillLibrary.length} learned`
}

// ============ Enhanced Subtask with DAG & Parallel ============

/**
 * Set subtasks with DAG dependencies and priority support.
 * Unlike setSubtasks(), this supports arbitrary dependency graphs.
 */
export function setSubtasksFromGraph(tasks: {
  description: string
  dependencies?: number[]
  priority?: number
  canParallel?: boolean
}[]): void {
  if (currentGoal) {
    currentGoal.subtasks = tasks.map((t, i) => ({
      id: generateSubtaskId(),
      description: t.description,
      status: 'pending' as const,
      dependencies: t.dependencies,
      priority: t.priority ?? 2,
      canParallel: t.canParallel ?? false,
    }))
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get all subtasks that are ready to execute (dependencies met).
 * Supports parallel execution of independent tasks.
 */
export function getReadySubtasks(): Subtask[] {
  if (!currentGoal?.subtasks) return []

  return currentGoal.subtasks.filter(subtask => {
    if (subtask.status !== 'pending') return false
    if (!subtask.dependencies) return true
    return subtask.dependencies.every(
      depIndex => currentGoal!.subtasks![depIndex]?.status === 'completed'
    )
  }).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
}

/**
 * Get parallel execution hint for the prompt.
 */
export function getParallelHint(): string | null {
  const ready = getReadySubtasks()
  const parallelReady = ready.filter(s => s.canParallel)
  if (parallelReady.length < 2) return null

  return `Parallelizable tasks available: ${parallelReady.map(s => s.description).join(', ')}`
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
    // Keep bounded — max 20 compact entries
    if (currentGoal.compactSummaries.length > 20) {
      currentGoal.compactSummaries = currentGoal.compactSummaries.slice(-20)
    }
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

const REFLECTION_PROMPT_TEMPLATE = `<reflection>SELF-REFLECTION REQUIRED (Turn {turn}):

Evaluate your progress and strategy:
1. Progress: {completed}/{total} steps completed, {failed} failed
2. Are you making meaningful progress toward the goal?
3. Is your current approach effective? Should you change strategy?
4. Are there any blockers you need to address differently?

If you need to change strategy, explain what and why. Then proceed with the adjusted approach.</reflection>`

/**
 * Get the reflection prompt to inject into continuation.
 */
export function getReflectionPrompt(): string | null {
  if (!shouldReflect()) return null

  const completedCount = currentGoal?.completedSteps?.length || 0
  const failedCount = currentGoal?.failedSteps?.length || 0
  const totalSteps = currentGoal?.executionPlan?.length || 0

  return REFLECTION_PROMPT_TEMPLATE
    .replace('{turn}', String(currentGoal?.turnsUsed))
    .replace('{completed}', String(completedCount))
    .replace('{total}', String(totalSteps))
    .replace('{failed}', String(failedCount))
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
      // Restore optional fields if present
      executionPlan: Array.isArray(p.executionPlan) ? p.executionPlan : undefined,
      completedSteps: Array.isArray(p.completedSteps) ? p.completedSteps : undefined,
      failedSteps: Array.isArray(p.failedSteps) ? p.failedSteps : undefined,
      subtasks: Array.isArray(p.subtasks) ? p.subtasks : undefined,
      episodicMemory: Array.isArray(p.episodicMemory) ? p.episodicMemory : undefined,
      skillLibrary: Array.isArray(p.skillLibrary) ? p.skillLibrary : undefined,
      replanCount: typeof p.replanCount === 'number' ? p.replanCount : undefined,
      reflections: Array.isArray(p.reflections) ? p.reflections : undefined,
      strategyChanges: Array.isArray(p.strategyChanges) ? p.strategyChanges : undefined,
      verification: isVerificationConfig(p.verification) ? p.verification : undefined,
      verificationResults: Array.isArray(p.verificationResults) ? p.verificationResults : undefined,
      budgetConfig: isBudgetConfig(p.budgetConfig) ? p.budgetConfig : undefined,
    }

    consecutiveZeroToolCalls = 0
    return true
  } catch {
    // Invalid serialized data
  }
  return false
}

// ============ Skill Demotion (PANDO Pattern) ============

const SKILL_DEMOTION_WINDOW = 10       // 近 10 次使用记录
const SKILL_DEMOTION_THRESHOLD = 0.5   // 成功率 < 50% 触发降级
const SKILL_CONSECUTIVE_FAIL_DEMOTE = 3 // 连续 3 次失败直接淘汰

/**
 * Record a skill usage outcome (success or failure).
 * Updates the success window and checks for demotion conditions.
 */
export function recordSkillOutcome(skillName: string, success: boolean): void {
  if (!currentGoal?.skillLibrary) return

  const skill = currentGoal.skillLibrary.find(s => s.name === skillName)
  if (!skill || skill.deprecated) return

  if (success) {
    skill.successCount++
  } else {
    skill.failureCount++
  }
  skill.lastUsedTurn = currentGoal.turnsUsed
  skill.successWindow.push(success)
  if (skill.successWindow.length > SKILL_DEMOTION_WINDOW) {
    skill.successWindow.shift()
  }

  // Check demotion conditions
  checkSkillDemotion(skill)
  currentGoal.updatedAt = Date.now()
}

/**
 * Check if a skill should be demoted based on its success window.
 */
function checkSkillDemotion(skill: SkillEntry): void {
  if (skill.deprecated) return

  const window = skill.successWindow

  // Condition 1: Consecutive failures
  if (window.length >= SKILL_CONSECUTIVE_FAIL_DEMOTE) {
    const lastN = window.slice(-SKILL_CONSECUTIVE_FAIL_DEMOTE)
    if (lastN.every(v => !v)) {
      skill.deprecated = true
      skill.deprecatedReason = `Consecutive ${SKILL_CONSECUTIVE_FAIL_DEMOTE} failures`
      return
    }
  }

  // Condition 2: Success rate below threshold (only after enough data)
  if (window.length >= SKILL_DEMOTION_WINDOW) {
    const successRate = window.filter(Boolean).length / window.length
    if (successRate < SKILL_DEMOTION_THRESHOLD) {
      skill.deprecated = true
      skill.deprecatedReason = `Success rate ${(successRate * 100).toFixed(0)}% < ${(SKILL_DEMOTION_THRESHOLD * 100)}% over last ${window.length} uses`
    }
  }
}

/**
 * Check if a skill is deprecated.
 */
export function isSkillDeprecated(skillName: string): boolean {
  if (!currentGoal?.skillLibrary) return false
  const skill = currentGoal.skillLibrary.find(s => s.name === skillName)
  return skill?.deprecated ?? false
}

/**
 * Get list of deprecated skills with their reasons.
 */
export function getDeprecatedSkills(): { name: string; reason: string }[] {
  if (!currentGoal?.skillLibrary) return []
  return currentGoal.skillLibrary
    .filter(s => s.deprecated)
    .map(s => ({ name: s.name, reason: s.deprecatedReason ?? 'unknown' }))
}

// ============ Auto-Verification ============

/**
 * Set verification commands for the current goal.
 */
export function setGoalVerification(config: VerificationConfig): void {
  if (currentGoal) {
    currentGoal.verification = config
    currentGoal.verificationResults = []
    currentGoal.updatedAt = Date.now()
    addAuditEntry('strategy_changed', { reason: 'verification_configured', commands: config.commands })
  }
}

/**
 * Get the verification config for the current goal.
 */
export function getGoalVerification(): VerificationConfig | null {
  return currentGoal?.verification ?? null
}

/**
 * Record a verification result.
 */
export function recordVerificationResult(result: VerificationResult): void {
  if (!currentGoal) return
  if (!currentGoal.verificationResults) currentGoal.verificationResults = []
  currentGoal.verificationResults.push(result)
  currentGoal.updatedAt = Date.now()
}

/**
 * Check if all verification commands passed.
 * Returns true only if every recorded verification has exitCode 0.
 */
export function isVerificationPassed(): boolean {
  if (!currentGoal?.verification) return true // No verification configured = pass
  if (!currentGoal.verificationResults?.length) return false // Configured but not run

  return currentGoal.verificationResults.every(r => r.exitCode === 0)
}

/**
 * Get verification status summary.
 */
export function getVerificationStatus(): string | null {
  if (!currentGoal?.verification) return null

  const results = currentGoal.verificationResults ?? []
  if (results.length === 0) return 'Verification: configured but not yet run'

  const passed = results.filter(r => r.exitCode === 0).length
  const failed = results.filter(r => r.exitCode !== 0).length

  if (failed > 0) {
    const lastFailure = results.filter(r => r.exitCode !== 0).pop()
    return `Verification: ${passed} passed, ${failed} failed (last: ${lastFailure?.command} exit ${lastFailure?.exitCode})`
  }
  return `Verification: all ${passed} commands passed`
}

// ============ Token Budget (Cost Guardrails) ============

/**
 * Set budget configuration for the current goal.
 */
export function setBudgetConfig(config: BudgetConfig): void {
  if (currentGoal) {
    currentGoal.budgetConfig = config
    currentGoal.updatedAt = Date.now()
  }
}

/**
 * Get the budget configuration for the current goal.
 */
export function getBudgetConfig(): BudgetConfig | null {
  return currentGoal?.budgetConfig ?? null
}

/**
 * Check if any budget warning thresholds have been crossed.
 * Returns warning messages for crossed thresholds.
 */
export function checkBudgetWarning(): string[] {
  if (!currentGoal?.budgetConfig) return []

  const warnings: string[] = []
  const budget = currentGoal.budgetConfig

  // Token warnings — sort thresholds descending so we report the highest crossed one
  if (budget.maxTokensTotal && budget.warningThresholds?.tokens) {
    const usagePercent = (currentGoal.tokensSpent / budget.maxTokensTotal) * 100
    const sortedThresholds = [...budget.warningThresholds.tokens].sort((a, b) => b - a)
    for (const threshold of sortedThresholds) {
      if (usagePercent >= threshold) {
        warnings.push(`Token usage at ${Math.round(usagePercent)}% (${currentGoal.tokensSpent}/${budget.maxTokensTotal})`)
        break // Only report the highest crossed threshold
      }
    }
  }

  return warnings
}

/**
 * Get a formatted budget status string.
 */
export function getBudgetStatus(): string | null {
  if (!currentGoal?.budgetConfig) return null

  const budget = currentGoal.budgetConfig
  const parts: string[] = []

  if (budget.maxTokensTotal) {
    const percent = Math.round((currentGoal.tokensSpent / budget.maxTokensTotal) * 100)
    parts.push(`Tokens: ${formatTokens(currentGoal.tokensSpent)}/${formatTokens(budget.maxTokensTotal)} (${percent}%)`)
  }
  if (budget.maxCostUSD) {
    parts.push(`Max: $${budget.maxCostUSD}`)
  }

  return parts.length > 0 ? parts.join(' | ') : null
}
