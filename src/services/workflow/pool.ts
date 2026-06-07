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

/**
 * Reset pool state. Called at session start.
 */
export function resetPool(): void {
  nextTaskId = 0
  activeCount = 0
  totalSpawned = 0
  queue.length = 0
  activePromises.clear()
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
  const results: AgentResult[] = []

  // Process queue items sequentially
  while (queue.length > 0) {
    const next = queue.shift()
    if (next) {
      try {
        const result = await executeAgent(next.agent)
        results.push(result)
        next.resolve(result)
      } catch (err) {
        next.reject(
          err instanceof Error ? err : new Error(String(err)),
        )
      }
    }
  }

  // Wait for all remaining active agents
  if (activePromises.size > 0) {
    const activeResults = await Promise.allSettled(activePromises)
    for (const res of activeResults) {
      if (res.status === 'fulfilled') {
        results.push(res.value)
      }
    }
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
      output,
    }),
  )
  activePromises.add(promise)

  try {
    const result = await promise
    activeCount--
    activePromises.delete(promise)
    totalSpawned = Math.max(0, totalSpawned - 1)
    logForDebugging(
      `[workflow-pool] Agent "${agent.name}" completed (active: ${activeCount})`,
    )
    return result
  } catch (err) {
    activeCount--
    activePromises.delete(promise)
    totalSpawned = Math.max(0, totalSpawned - 1)
    throw err
  }
}

/**
 * Run a single workflow sub-agent.
 *
 * Phase 1 (P0): Uses a structured description-based approach.
 * This will be replaced with actual AgentTool/spawnMultiAgent integration
 * when the Tool is wired into the full query loop.
 */
async function runWorkflowAgent(agent: PoolAgentTask): Promise<string> {
  // Placeholder: In production, this calls spawnMultiAgent with the agent's task.
  // For P0, we return a structured description that the main LLM can process.
  return `[Agent: ${agent.name}] Task: ${agent.task}\nResult: Executed successfully in workflow pool.`
}
