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

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

export interface WorkflowOptions {
  task: string
  skill?: string
  workDir: string
}

export interface WorkflowResult {
  agentsUsed: number
  finalAnswer: string
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
): Promise<WorkflowResult> {
  if (scriptSource.length > MAX_SCRIPT_SIZE_BYTES) {
    throw new Error(
      `Workflow script too large: ${scriptSource.length} bytes (max ${MAX_SCRIPT_SIZE_BYTES})`,
    )
  }

  let agentsUsed = 0
  let finalAnswer = ''
  const spawned: Array<Promise<unknown>> = []
  let hasReturned = false

  const sandbox: Record<string, unknown> = {
    spawn: (name: string, task: string) => {
      if (hasReturned) {
        throw new Error('Cannot spawn after return() has been called')
      }
      agentsUsed++
      // Phase 2: delegate to the agent pool (pool.ts)
      spawned.push(Promise.resolve({ name, task, result: `Agent ${name} completed: ${task}` }))
    },

    waitAll: async () => {
      await Promise.all(spawned)
      spawned.length = 0
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

  if (!finalAnswer) {
    throw new Error(
      'Workflow script did not call return(). Ensure the script ends with return(answer).',
    )
  }

  return { agentsUsed, finalAnswer }
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
 * High-level entry point: generates script from task description via LLM,
 * then executes it in the sandbox.
 *
 * TODO(Phase 2): Integrate LLM script generation. Currently returns a
 * placeholder — the main LLM handles orchestration in its response loop.
 */
export async function executeWorkflow(
  options: WorkflowOptions,
): Promise<WorkflowResult> {
  // Phase 1 (P0): Placeholder — LLM-generated script execution will be
  // integrated when the Tool is wired into the query loop.
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
