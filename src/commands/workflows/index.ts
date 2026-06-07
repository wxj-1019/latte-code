/**
 * /workflows — List and manage dynamic workflow scripts.
 */
import type { Command, LocalCommandResult } from '../../types/command.js'
import { feature } from 'bun:bundle'

const isEnabled = () => feature('WORKFLOW_SCRIPTS')

const workflowsCommand: Command = {
  type: 'local',
  name: 'workflows',
  description: 'List, create, and manage dynamic workflow scripts',
  descriptionZh: '列出、创建和管理动态工作流脚本',
  argumentHint: '[list|create|run <name>]',
  isEnabled,
  supportsNonInteractive: false,
  async load() {
    return {
      async call(args: string): Promise<LocalCommandResult> {
        const subcommand = args.trim().split(/\s+/)[0] || 'list'
        switch (subcommand) {
          case 'list':
            return { type: 'text', value: 'Available workflows:\n  (No workflows installed yet. Create scripts in .claude/workflows/)' }
          case 'create':
            return { type: 'text', value: 'To create a workflow, add a JavaScript orchestration script to .claude/workflows/<name>.js' }
          default:
            return { type: 'text', value: `Unknown subcommand: ${subcommand}. Use /workflows list to see available workflows.` }
        }
      },
    }
  },
}

export default workflowsCommand
