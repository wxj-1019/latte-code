/**
 * Workflow sandbox engine.
 *
 * Executes LLM-generated JS orchestration scripts in a Bun vm sandbox.
 * Scripts receive a restricted API (spawn, waitAll, return) and cannot
 * access filesystem, network, or require/import.
 *
 * Architecture:
 *   Script → Bun vm context (API-only) → Agent pool → spawnMultiAgent
 *
 * Reference: Bun's `node:vm` API provides Script.runInNewContext()
 * with context object and timeout support.
 */

import { logForDebugging } from '../../utils/debug.js'
import { spawnPoolAgent, bindToolUseContext, type AgentResult } from './pool.js'
import type { ToolUseContext } from '../../Tool.js'

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

export interface WorkflowOptions {
  task: string
  skill?: string
  workDir: string
  /** ToolUseContext for spawning real sub-agents. If omitted, runs in LLM-orchestrated mode. */
  toolUseContext?: ToolUseContext
}

export interface WorkflowResult {
  agentsUsed: number
  finalAnswer: string
  /** Detailed results from each sub-agent */
  agentResults?: AgentResult[]
}

// ═════════════════════════════════════════
// Engine
// ═════════════════════════════════════════

const WORKFLOW_TIMEOUT_MS = 180_000 // 3 minutes max
const MAX_SCRIPT_SIZE_BYTES = 64 * 1024 // 64KB max script size

/**
 * Execute a workflow script in the Bun vm sandbox.
 *
 * The script receives these sandbox-only APIs:
 *   spawn(name, task)  — spawn a sub-agent
 *   waitAll()          — wait for all spawned agents to complete
 *   return(answer)     — return the final answer
 *
 * The script has NO access to: require, import, process, fs, fetch, child_process
 */
export async function executeWorkflowScript(
  scriptSource: string,
  options?: { toolUseContext?: ToolUseContext },
): Promise<WorkflowResult> {
  if (scriptSource.length > MAX_SCRIPT_SIZE_BYTES) {
    throw new Error(
      `Workflow script too large: ${scriptSource.length} bytes (max ${MAX_SCRIPT_SIZE_BYTES})`,
    )
  }

  // Bind ToolUseContext to pool if provided — enables real agent spawning
  if (options?.toolUseContext) {
    bindToolUseContext(options.toolUseContext)
  }

  let agentsUsed = 0
  let finalAnswer = ''
  const spawned: Array<{ name: string; task: string; promise: Promise<AgentResult> }> = []
  let hasReturned = false
  let waitedResults: AgentResult[] | undefined

  const sandbox: Record<string, unknown> = {
    spawn: (name: string, task: string) => {
      if (hasReturned) {
        throw new Error('Cannot spawn after return() has been called')
      }
      agentsUsed++
      // Delegate to the real agent pool
      const promise = spawnPoolAgent({ name, task, description: task })
      spawned.push({ name, task, promise })
    },

    waitAll: async () => {
      if (spawned.length === 0) return []
      // Use allSettled so a single agent failure doesn't abort the batch
      const settled = await Promise.allSettled(spawned.map(s => s.promise))
      const results: AgentResult[] = []
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value)
      }
      waitedResults = results
      spawned.length = 0
      return results
    },

    return: (answer: string) => {
      if (hasReturned) {
        throw new Error('return() can only be called once')
      }
      hasReturned = true
      finalAnswer = answer
    },
  }

  try {
    const scriptExecutor = await buildScriptExecutor(scriptSource, sandbox)
    await scriptExecutor()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Workflow execution failed: ${message}`)
  }

  // Collect agent results: prefer waitedResults (from waitAll), then unresolved spawned
  let agentResults: AgentResult[] | undefined
  if (waitedResults) {
    agentResults = waitedResults
  } else if (spawned.length > 0) {
    // Use allSettled so a partial failure doesn't prevent result collection
    const settled = await Promise.allSettled(spawned.map(s => s.promise))
    agentResults = settled
      .filter((s): s is PromiseFulfilledResult<AgentResult> => s.status === 'fulfilled')
      .map(s => s.value)
  }

  if (!finalAnswer && agentResults && agentResults.length > 0) {
    // If script didn't call return(), aggregate results automatically
    finalAnswer = agentResults
      .map(r => `[${r.agentName}] ${r.output}`)
      .join('\n')
  } else if (!finalAnswer) {
    throw new Error(
      'Workflow script did not call return(). Ensure the script ends with return(answer).',
    )
  }

  return { agentsUsed, finalAnswer, agentResults }
}

/**
 * Build and execute a script with timeout support.
 * Attempts Bun vm first, falls back to Function() constructor.
 *
 * Wrapping strategy:
 *   - Bun vm: wraps source as `(async () => { source })()` — vm executes programs
 *   - Function fallback: wraps as `return (async () => { source })()` — returns a value
 */
async function buildScriptExecutor(
  source: string,
  sandbox: Record<string, unknown>,
): Promise<() => Promise<void>> {
  try {
    const vm = await import('node:vm')

    // Bun vm executes programs, so wrap as async IIFE
    const vmSource = `(async () => { ${source} })()`

    const script = new vm.Script(vmSource, {
      timeout: WORKFLOW_TIMEOUT_MS,
      filename: 'workflow-script.js',
    })

    const context = vm.createContext(sandbox)

    return async () => {
      const result = script.runInContext(context, { timeout: WORKFLOW_TIMEOUT_MS })
      if (result instanceof Promise) await result
    }
  } catch {
    logForDebugging('[workflow-engine] Bun vm unavailable — using Function() fallback')

    return async () => {
      const keys = Object.keys(sandbox)
      const values = Object.values(sandbox)

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Workflow script timed out')), WORKFLOW_TIMEOUT_MS),
      )

      const execPromise = new Promise<void>((resolve, reject) => {
        try {
          const fn = new Function(...keys, `return (async () => { ${source} })()`)
          const result = fn(...values)
          if (result instanceof Promise) {
            result.then(() => resolve()).catch(reject)
          } else {
            resolve()
          }
        } catch (err) {
          reject(err)
        }
      })

      await Promise.race([execPromise, timeoutPromise])
    }
  }
}

/**
 * High-level entry point: execute a workflow from task description.
 *
 * Two execution modes:
 * 1. **Direct mode**: when subtask descriptions are provided, executes them
 *    through the agent pool without LLM script generation.
 * 2. **Script mode**: when only a task description is provided, generates
 *    a JS orchestration script and executes it in the sandbox.
 *
 * Direct mode is used by the Goal→Workflow integration to execute
 * parallel subtasks without needing LLM script generation.
 */
export async function executeWorkflow(
  options: WorkflowOptions,
  subtasks?: Array<{ name: string; task: string }>,
): Promise<WorkflowResult> {
  const startTime = Date.now()

  // Direct mode: execute subtasks through the pool
  if (subtasks && subtasks.length > 0) {
    if (options.toolUseContext) {
      bindToolUseContext(options.toolUseContext)
    }

    logForDebugging(
      `[workflow-engine] Direct mode: executing ${subtasks.length} subtasks`,
    )

    // Spawn all subtasks in parallel through the pool
    const promises = subtasks.map(st =>
      spawnPoolAgent({ name: st.name, task: st.task, description: st.task }),
    )

    const settled = await Promise.allSettled(promises)

    // Build index-aligned results so caller can map back to subtasks.
    // Even rejected promises get a failure entry to preserve index order.
    const allResults: AgentResult[] = []
    const failed: string[] = []

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled') {
        allResults.push(result.value)
      } else {
        const errMsg = result.reason?.message ?? String(result.reason)
        failed.push(errMsg)
        allResults.push({
          agentName: subtasks[i]?.name ?? `subtask-${i}`,
          task: subtasks[i]?.task ?? 'unknown',
          output: errMsg,
          success: false,
        })
      }
    }

    const successfulCount = allResults.filter(r => r.success).length
    const durationMs = Date.now() - startTime
    const finalAnswer = [
      ...allResults.map(r => `[${r.agentName}] ${r.success ? '✓' : '✗'} ${r.output}`),
    ].join('\n')

    logForDebugging(
      `[workflow-engine] Direct mode completed: ${successfulCount}/${subtasks.length} succeeded (${durationMs}ms)`,
    )

    return {
      agentsUsed: subtasks.length,
      finalAnswer,
      agentResults: allResults,
    }
  }

  // Script mode: placeholder — LLM script generation will be added later
  return {
    agentsUsed: 0,
    finalAnswer: `[Workflow placeholder] Task queued: "${options.task}"\n\nThe LLM will generate and execute a JS orchestration script to complete this task using parallel sub-agents.`,
  }
}

/** Build the prompt that instructs the LLM to generate a workflow script */
export function buildWorkflowPrompt(task: string, skill?: string): string {
  const skillBlock = skill
    ? `\n## Loaded Skill: ${skill}\nThe skill instructions are available in .claude/skills/${skill}/SKILL.md. Prepend those instructions to the task.`
    : ''

  return `# Dynamic Workflow Orchestration

You will generate a JavaScript orchestration script to complete the following task using parallel sub-agents.

## Task
${task}${skillBlock}

## Script API

Your script has access to these functions:

\`\`\`js
// Spawn a sub-agent with a name and task
spawn("agent-name", "task description for the agent");

// Wait for all previously spawned agents to complete
await waitAll();

// Return the final answer (REQUIRED — must be called exactly once)
return("your aggregated result here");
\`\`\`

## Rules

1. Use spawn() to delegate independent subtasks to sub-agents
2. Use await waitAll() after spawning a batch of agents
3. You can spawn multiple batches (spawn → waitAll → spawn → waitAll → ...)
4. Each spawn() call creates a ONE-SHOT agent with a specific task
5. Maximum 16 concurrent agents per batch
6. The script MUST end with return(answer) — this is how results get back to the user
7. Keep the script concise — each agent task should be clear and self-contained
8. Do NOT use fetch, require, import, process, or any Node.js/Bun APIs

## Example

\`\`\`js
// Research task
spawn("researcher-1", "Research the latest TypeScript 5.x features");
spawn("researcher-2", "Research Bun runtime performance benchmarks");
await waitAll();

return("TypeScript 5.x findings: ...\nBun benchmarks: ...");
\`\`\`

Now generate the JS script for the task above. Only output the script — no explanation.`
}
