/**
 * Workflow command factory.
 *
 * Generates Command objects for individual workflow scripts found in
 * .claude/workflows/. Used by the getWorkflowCommands function in
 * commands.ts to dynamically populate the command list.
 *
 * Each workflow script becomes a /<script-name> command that, when
 * invoked, sends the script to the Workflow Engine for execution.
 */

import type { Command, LocalCommandResult } from '../../types/command.js'
import { existsSync, readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Scan .claude/workflows/ and generate a Command for each .js file.
 * Called from commands.ts at command resolution time.
 */
export async function getWorkflowCommands(
  cwd: string,
): Promise<Command[]> {
  const workflowsDir = join(cwd, '.claude', 'workflows')

  if (!existsSync(workflowsDir)) {
    return []
  }

  try {
    const entries = readdirSync(workflowsDir)
    const commands: Command[] = []

    for (const entry of entries) {
      if (!entry.endsWith('.js')) continue

      const fullPath = join(workflowsDir, entry)
      const stat = lstatSync(fullPath)
      if (!stat.isFile()) continue

      const name = entry.replace('.js', '')

      commands.push({
        type: 'local',
        name,
        description: `Execute the ${name} workflow`,
        descriptionZh: `执行 ${name} 工作流`,
        kind: 'workflow',
        argumentHint: '[args...]',
        isEnabled: () => true,
        userInvocable: true,
        supportsNonInteractive: false,
        load: () => buildWorkflowCommandModule(name, fullPath),
      })
    }

    return commands
  } catch {
    return []
  }
}

/**
 * Build a lazy-loadable command module for a single workflow script.
 */
async function buildWorkflowCommandModule(
  name: string,
  scriptPath: string,
): Promise<{ call: (args: string) => Promise<LocalCommandResult> }> {
  return {
    async call(args: string): Promise<LocalCommandResult> {
      const taskDescription = args.trim() || `Execute the ${name} workflow`

      return {
        type: 'text',
        value: `To execute the "${name}" workflow, the model should invoke the Workflow tool with:\n- task: "${taskDescription}"\n- skill: "${name}"\n\nThe workflow script is located at ${scriptPath}.`,
      }
    },
  }
}
