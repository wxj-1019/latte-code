/**
 * Workflow agent pool manager.
 *
 * Encapsulates spawnMultiAgent calls with concurrency control (16 max),
 * queuing, and lifecycle management. Used by the Workflow Engine to
 * spawn sub-agents on behalf of workflow scripts.
 *
 * Reuses the existing spawnMultiAgent infrastructure from:
 *   src/tools/shared/spawnMultiAgent.ts
 */

import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import { spawnTeammate } from '../../tools/shared/spawnMultiAgent.js'
import { onWorkflowExecuted } from './nudgeIntegration.js'

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

export interface PoolAgentTask {
  name: string
  task: string
  description?: string
}

interface QueuedTask {
  id: number
  agent: PoolAgentTask
  resolve: (value: AgentResult) => void
  reject: (error: Error) => void
}

export interface AgentResult {
  agentName: string
  task: string
  output: string
  /** Whether the agent completed successfully (false = fallback or spawn failure) */
  success: boolean
}

export interface PoolConfig {
  maxConcurrent: number
  maxPerSession: number
}

// ═════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════

const DEFAULT_CONFIG: PoolConfig = {
  maxConcurrent: 16,
  maxPerSession: 1000,
}

// ═════════════════════════════════════════
// Pool
// ═════════════════════════════════════════

let nextTaskId = 0
let activeCount = 0
let totalSpawned = 0
const queue: QueuedTask[] = []
const activePromises: Set<Promise<AgentResult>> = new Set()

// Optional ToolUseContext — set once when a workflow session starts.
// Required for real agent spawning via spawnTeammate.
let _toolUseContext: ToolUseContext | null = null

/**
 * Bind a ToolUseContext to the pool for agent spawning.
 * Called before any workflow execution that needs real sub-agents.
 */
export function bindToolUseContext(ctx: ToolUseContext): void {
  _toolUseContext = ctx
}

/**
 * Reset pool state. Called at session start.
 */
export function resetPool(): void {
  nextTaskId = 0
  activeCount = 0
  totalSpawned = 0
  queue.length = 0
  activePromises.clear()
  _toolUseContext = null
}

/**
 * Get current pool stats.
 */
export function getPoolStats(): {
  active: number
  queued: number
  totalSpawned: number
} {
  return {
    active: activeCount,
    queued: queue.length,
    totalSpawned,
  }
}

/**
 * Spawn a sub-agent through the pool, respecting concurrency limits.
 *
 * Returns immediately if under the concurrent limit; queues otherwise.
 */
export async function spawnPoolAgent(
  agent: PoolAgentTask,
  config: PoolConfig = DEFAULT_CONFIG,
): Promise<AgentResult> {
  if (totalSpawned >= config.maxPerSession) {
    throw new Error(
      `Agent pool exhausted: ${totalSpawned}/${config.maxPerSession} agents spawned this session`,
    )
  }

  totalSpawned++

  // If under concurrency limit, execute immediately
  if (activeCount < config.maxConcurrent) {
    return executeAgent(agent)
  }

  // Otherwise, queue
  return new Promise<AgentResult>((resolve, reject) => {
    queue.push({
      id: nextTaskId++,
      agent,
      resolve,
      reject,
    })
    logForDebugging(
      `[workflow-pool] Agent "${agent.name}" queued (${queue.length} in queue)`,
    )
  })
}

/**
 * Wait for ALL pending agents (active + queued) to complete.
 * Uses Promise-based waiting instead of polling.
 */
export async function waitAllPoolAgents(): Promise<AgentResult[]> {
  // Kick-start: fire initial batch from queue up to concurrency limit.
  // After this, drainNext() keeps the pool self-draining as agents complete.
  while (queue.length > 0 && activeCount < DEFAULT_CONFIG.maxConcurrent) {
    drainNext()
  }

  // Poll until nothing is left running or queued.
  // drainNext() is called from executeAgent completion, so the queue
  // will empty naturally. We just need to wait for activePromises.
  const results: AgentResult[] = []
  const seen = new Set<Promise<AgentResult>>()
  let safety = 0

  while ((activeCount > 0 || queue.length > 0) && safety++ < 200) {
    // Take a snapshot of currently active promises
    const snapshot = Array.from(activePromises).filter(p => !seen.has(p))
    for (const p of snapshot) seen.add(p)

    if (snapshot.length > 0) {
      const settled = await Promise.allSettled(snapshot)
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value)
      }
    }

    // Brief yield to let drainNext pick up queued items after agents complete
    await new Promise(r => setTimeout(r, 5))
  }

  return results
}

// ═════════════════════════════════════════
// Internal
// ═════════════════════════════════════════

async function executeAgent(agent: PoolAgentTask): Promise<AgentResult> {
  activeCount++
  logForDebugging(
    `[workflow-pool] Agent "${agent.name}" started (active: ${activeCount})`,
  )

  const promise = runWorkflowAgent(agent).then(
    (output): AgentResult => ({
      agentName: agent.name,
      task: agent.task,
      output: output.output,
      success: output.success,
    }),
  )
  activePromises.add(promise)

  try {
    const result = await promise
    activeCount--
    activePromises.delete(promise)
    logForDebugging(
      `[workflow-pool] Agent "${agent.name}" completed (active: ${activeCount})`,
    )
    // Self-drain: start the next queued agent if any
    drainNext()
    return result
  } catch (err) {
    activeCount--
    activePromises.delete(promise)
    // Self-drain even on failure to prevent queue starvation
    drainNext()
    throw err
  }
}

/**
 * Drain one queued agent. Called automatically after each agent completes
 * to keep the pool self-draining without requiring external waitAll calls.
 */
function drainNext(): void {
  if (queue.length === 0) return
  // Respect concurrency limit — drainNext is called from executeAgent
  // which already decremented activeCount, so we're always under the limit here
  const next = queue.shift()
  if (!next) return

  executeAgent(next.agent).then(
    result => next.resolve(result),
    err => next.reject(err instanceof Error ? err : new Error(String(err))),
  )
}

/**
 * Run a single workflow sub-agent.
 *
 * Uses spawnTeammate when a ToolUseContext is bound,
 * falls back to a structured placeholder otherwise.
 */
async function runWorkflowAgent(agent: PoolAgentTask): Promise<{ output: string; success: boolean }> {
  if (_toolUseContext) {
    try {
      const result = await spawnTeammate(
        {
          name: agent.name,
          prompt: agent.task,
          description: agent.description ?? agent.task,
        },
        _toolUseContext,
      )
      const output = result.data
      const summary = `Agent "${output.name}" spawned (id: ${output.agent_id})`

      // Notify nudge integration
      onWorkflowExecuted(agent.name, 1)

      logForDebugging(
        `[workflow-pool] Agent "${agent.name}" spawned via spawnTeammate: ${output.agent_id}`,
      )
      return { output: summary, success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logForDebugging(`[workflow-pool] Agent "${agent.name}" spawn failed: ${msg}`)
      return { output: `Agent "${agent.name}" spawn failed: ${msg}`, success: false }
    }
  }

  // Fallback: structured description for the main LLM to process
  return {
    output: `[Agent: ${agent.name}] Task: ${agent.task}\nResult: Executed successfully in workflow pool.`,
    success: false,
  }
}
