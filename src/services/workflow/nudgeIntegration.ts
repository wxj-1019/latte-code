/**
 * Nudge Engine ↔ Workflow Engine integration.
 *
 * Bridges the auto-learning system with the auto-execution system:
 *
 *   Nudge Engine detects pattern → autoSkillify generates Skill
 *        ↓
 *   High-confidence Skill → Workflow Engine auto-executes
 *        ↓
 *   Execution results → memdir + Nudge feedback loop
 *
 * Follows the same closure-scoped pattern as nudgeEngine.ts,
 * extractMemories, and autoDream.
 */

import { logForDebugging } from '../../utils/debug.js'
import { isNudgeEngineEnabled } from '../nudgeEngine/nudgeConfig.js'
import { getPoolStats } from './pool.js'

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

interface AutoExecuteStats {
  skillsGenerated: number
  skillsExecuted: number
  totalExecutions: number
  lastExecutionTime: number
}

// ═════════════════════════════════════════
// State (closure-scoped)
// ═════════════════════════════════════════

let stats: AutoExecuteStats = {
  skillsGenerated: 0,
  skillsExecuted: 0,
  totalExecutions: 0,
  lastExecutionTime: 0,
}

let initialized = false

// Minimum confidence score (executions of a specific skill) for auto-execution
const AUTO_EXECUTE_THRESHOLD = 3

// Track per-skill execution counts and timestamps
const skillExecutions = new Map<string, { count: number; lastTime: number }>()

/**
 * Initialize the Nudge→Workflow integration.
 * Called from backgroundHousekeeping after Nudge Engine is initialized.
 */
export function initWorkflowNudgeIntegration(): void {
  if (initialized) return
  if (!isNudgeEngineEnabled()) {
    logForDebugging(
      '[workflow-nudge] Nudge Engine disabled — skipping integration init',
    )
    return
  }

  initialized = true
  logForDebugging('[workflow-nudge] Integration initialized')
}

/**
 * Called when Nudge Engine successfully generates a Skill via autoSkillify.
 *
 * Tracks the generation count and, if the skill's confidence exceeds the
 * threshold, schedules an auto-execution of the skill.
 */
export function onSkillGenerated(skillName: string): void {
  if (!initialized) return

  stats.skillsGenerated++
  logForDebugging(
    `[workflow-nudge] Skill generated: ${skillName} (total: ${stats.skillsGenerated})`,
  )

  // P0: Track the generation. Auto-execution will be triggered
  // by the WorkflowTool when the user interacts with the skill.
  // Phase 2 will add automatic background execution.
}

/**
 * Called when a Workflow execution completes.
 *
 * Updates execution statistics and feeds back to the Nudge Engine's
 * confidence tracking. High-execution-count skills are candidates
 * for promotion to permanent (non-auto-prefixed) skills.
 */
export function onWorkflowExecuted(
  skillName: string,
  agentCount: number,
): void {
  if (!initialized) return

  stats.skillsExecuted++
  stats.totalExecutions++
  stats.lastExecutionTime = Date.now()

  // Track per-skill execution count for shouldAutoExecute
  const existing = skillExecutions.get(skillName)
  skillExecutions.set(skillName, {
    count: (existing?.count ?? 0) + 1,
    lastTime: Date.now(),
  })

  logForDebugging(
    `[workflow-nudge] Workflow executed: ${skillName} (${agentCount} agents, ` +
      `total: ${stats.skillsExecuted} executions, ` +
      `skill count: ${skillExecutions.get(skillName)?.count})`,
  )

  // In Phase 2: feed back execution count to Nudge Engine's
  // confidence scoring to enable automatic execution of proven skills.
}

/**
 * Check if a specific skill should be auto-executed based on its own
 * execution frequency and per-skill cooldown.
 */
export function shouldAutoExecute(skillName: string): boolean {
  if (!initialized) return false

  const skillData = skillExecutions.get(skillName)
  if (!skillData || skillData.count < AUTO_EXECUTE_THRESHOLD) return false

  // Per-skill cooldown: 5 minutes between auto-executions of the same skill
  const PER_SKILL_COOLDOWN_MS = 5 * 60 * 1000
  const inCooldown = Date.now() - skillData.lastTime < PER_SKILL_COOLDOWN_MS

  return !inCooldown
}

/**
 * Get integration statistics.
 */
export function getWorkflowNudgeStats(): Readonly<AutoExecuteStats> {
  return { ...stats }
}

/**
 * Check pool status for Nudge Engine awareness.
 * Nudge Engine can use this to avoid triggering workflows when
 * the pool is already saturated.
 */
export function isPoolAvailable(): boolean {
  const { active, queued } = getPoolStats()
  return active + queued < 12 // Leave headroom
}
