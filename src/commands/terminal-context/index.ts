/**
 * /terminal — View and inject terminal state into AI context.
 *
 * Subcommands:
 *   (no args)           → Show terminal status summary
 *   context | inject    → Inject full terminal context into conversation
 *   screen              → Capture visible screen content
 *   outputs | history   → Show recent command outputs
 *   clear | reset       → Clear output history
 */
import type { Command, LocalCommandResult } from '../../types/command.js'
import {
  captureTerminalState,
  getTerminalStatus,
  formatTerminalContext,
  clearTerminalHistory,
} from '../../services/terminalAwareness.js'

const terminalCommand: Command = {
  type: 'local',
  name: 'terminal',
  aliases: ['term'],
  description: 'View terminal state and inject context into conversation',
  descriptionZh: '查看终端状态并将上下文注入对话',
  argumentHint: '[context|screen|outputs|clear]',
  supportsNonInteractive: false,
  async load() {
    return {
      async call(args: string): Promise<LocalCommandResult> {
        const subcommand = args.trim().split(/\s+/)[0] || ''

        switch (subcommand) {
          case 'context':
          case 'inject': {
            const state = captureTerminalState()
            const message = formatTerminalContext(state)

            // Inject terminal context as a query into the conversation
            return {
              type: 'query',
              value: `[Terminal Context]\n${message}`,
              displayText: `Terminal context injected (${state.dimensions.columns}x${state.dimensions.rows}, ${state.recentOutputs.length} outputs)`,
            }
          }

          case 'screen': {
            const state = captureTerminalState()

            const lines = [
              '## Terminal Screen',
              `Terminal: ${state.capabilities.terminal}`,
              `Size: ${state.dimensions.columns}x${state.dimensions.rows}`,
              `Color: ${state.capabilities.colorDepth}-bit`,
              '',
              'To capture screen content, use `/terminal context` to inject the full terminal state into the conversation.',
            ]

            return { type: 'text', value: lines.join('\n') }
          }

          case 'outputs':
          case 'history': {
            const state = captureTerminalState()

            if (state.recentOutputs.length === 0) {
              return { type: 'text', value: 'No command outputs recorded yet.' }
            }

            const lines = ['## Recent Command Outputs', '']
            for (let i = state.recentOutputs.length - 1; i >= 0; i--) {
              const output = state.recentOutputs[i]
              const status = output.exitCode === 0 ? '✓' : '✗'
              const time = new Date(output.timestamp).toLocaleTimeString()
              lines.push(`${status} [${time}] \`${output.command.slice(0, 120)}\``)
            }

            return { type: 'text', value: lines.join('\n') }
          }

          case 'clear':
          case 'reset': {
            clearTerminalHistory()
            return { type: 'text', value: 'Terminal output history cleared.' }
          }

          default: {
            const status = getTerminalStatus()
            const lines = [
              '## Terminal Status',
              `${status}`,
              '',
              'Subcommands:',
              '  /terminal context   — Inject full terminal context',
              '  /terminal screen    — Capture screen content',
              '  /terminal outputs   — Show recent command outputs',
              '  /terminal clear     — Clear output history',
            ]
            return { type: 'text', value: lines.join('\n') }
          }
        }
      },
    }
  },
}

export default terminalCommand
