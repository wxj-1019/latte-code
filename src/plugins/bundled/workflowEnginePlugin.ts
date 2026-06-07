/**
 * Built-in Plugin: Workflow Engine
 *
 * Enables dynamic workflow orchestration — automatically executes
 * complex multi-step tasks by spawning parallel sub-agents coordinated
 * through JavaScript orchestration scripts.
 *
 * Plugin ID: workflow-engine@builtin
 */
import { feature } from 'bun:bundle'
import type { BuiltinPluginDefinition } from '../../types/plugin.js'

export const workflowEnginePlugin: BuiltinPluginDefinition = {
  name: 'Workflow Engine',
  description:
    'Dynamic workflow orchestration — automatically decomposes complex tasks into parallel sub-agent executions. ' +
    'Supports 16 concurrent agents with checkpoint recovery.',
  version: '1.0.0',
  defaultEnabled: false,
  isAvailable: () => feature('WORKFLOW_SCRIPTS') ? true : false,
}
