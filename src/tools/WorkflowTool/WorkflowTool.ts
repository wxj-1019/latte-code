/**
 * WorkflowTool — Dynamic workflow orchestration engine.
 *
 * Replaces the 45-byte constants stub with a full tool implementation.
 * Accepts a task description (and optional skill name), generates a JS
 * orchestration script via LLM, executes it in a Bun vm sandbox, and
 * manages a pool of sub-agents through spawnMultiAgent.
 *
 * Three trigger models:
 * 1. Auto: Nudge Engine detects a high-confidence Skill → auto-execute
 * 2. Keyword: User mentions "workflow" or "ultracode" → LLM writes script
 * 3. Manual: /workflow <skill-name>
 */
import { buildTool } from '../../Tool.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import {
  executeWorkflow,
  type WorkflowResult,
} from '../../services/workflow/engine.js'

// ═════════════════════════════════════════
// Schema
// ═════════════════════════════════════════

const inputSchema = lazySchema(() =>
  z.strictObject({
    task: z
      .string()
      .describe(
        'The task description for the workflow. Can be natural language ' +
          'that the LLM will translate into a JS orchestration script.',
      ),
    skill: z
      .string()
      .optional()
      .describe(
        'Optional skill name to load from .claude/skills/. ' +
          'If provided, the skill instructions are prepended to the task.',
      ),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z.string().describe('The task that was executed'),
    agentsUsed: z.number().describe('Number of sub-agents spawned'),
    result: z.string().describe('Final aggregated result from the workflow'),
    durationMs: z.number().describe('Total execution time in milliseconds'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>

// ═════════════════════════════════════════
// Tool
// ═════════════════════════════════════════

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint:
    'orchestrate multiple sub-agents for complex multi-step tasks',
  maxResultSizeChars: 100_000,
  shouldDefer: true,

  async description(input) {
    if (input.skill) {
      return `Orchestrates workflow: ${input.task} (using skill: ${input.skill})`
    }
    return `Orchestrates workflow: ${input.task}`
  },

  userFacingName() {
    return 'Workflow'
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isConcurrencySafe() {
    // Workflows manage their own internal concurrency
    return true
  },

  isReadOnly() {
    // Workflows spawn agents that may write files
    return false
  },

  async call(
    { task, skill }: Input,
    toolUseContext,
  ) {
    const startTime = Date.now()
    const appState = toolUseContext.getAppState()
    const workDir = appState.getCwd()

    const result: WorkflowResult = await executeWorkflow({
      task,
      skill,
      workDir,
    })

    return {
      data: {
        task,
        agentsUsed: result.agentsUsed,
        result: result.finalAnswer,
        durationMs: Date.now() - startTime,
      },
    }
  },

  renderToolUseMessage(input, _options) {
    return `  🔄 Orchestrating workflow: ${input.task ?? 'loading...'}${input.skill ? ` (skill: ${input.skill})` : ''}`
  },

  renderToolResultMessage(result, _input) {
    const output = result as { data: { agentsUsed: number; result: string; durationMs: number } }
    return `  ✅ Workflow completed (${output.data.agentsUsed} agents, ${output.data.durationMs}ms)\n${output.data.result.slice(0, 500)}`
  },
})
