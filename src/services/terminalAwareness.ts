/**
 * Terminal State Awareness.
 *
 * Provides automatic terminal context injection so the AI can understand
 * the current terminal state without manual copy-paste from the user.
 *
 * Capabilities:
 *  - Screen buffer text capture (visible viewport)
 *  - Terminal capability detection (colors, dimensions, protocols)
 *  - Recent command output references
 *  - Auto-context injection via /terminal and automatic suggestions
 *
 * Integrates with the existing Ink screen buffer, terminal querier,
 * and BashTool output capture infrastructure.
 */

import { logForDebugging } from '../utils/debug.js'

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

export interface TerminalState {
  /** Visible screen content as text (up to maxLines) */
  screenContent: string
  /** Terminal dimensions */
  dimensions: {
    columns: number
    rows: number
  }
  /** Detected terminal capabilities */
  capabilities: TerminalCapabilities
  /** Recent command outputs (from BashTool) */
  recentOutputs: CommandOutput[]
  /** When this snapshot was taken */
  timestamp: number
}

export interface TerminalCapabilities {
  terminal: string
  supportsSyncOutput: boolean
  supportsProgressReporting: boolean
  supportsExtendedKeys: boolean
  supportsKittyProtocol: boolean
  isTmux: boolean
  isSsh: boolean
  colorDepth: number
}

interface CommandOutput {
  command: string
  exitCode: number
  summary: string
  timestamp: number
}

// ═════════════════════════════════════════
// State (in-memory, session-scoped)
// ═════════════════════════════════════════

const MAX_OUTPUT_HISTORY = 50
const OUTPUT_SUMMARY_MAX_LENGTH = 200
const COMMAND_TRUNCATE_LENGTH = 200
export const SCREEN_CONTENT_UNAVAILABLE = '(Screen content not available — use /terminal to capture)'

let commandOutputs: CommandOutput[] = []

/**
 * Provide a recent command result to the awareness system.
 * Called from BashTool after command completion.
 */
export function recordCommandOutput(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): void {
  // Capture both stdout and stderr when both are non-empty
  let summary = ''
  if (stdout && stderr) {
    summary = `[stdout]\n${stdout.slice(0, OUTPUT_SUMMARY_MAX_LENGTH)}${stdout.length > OUTPUT_SUMMARY_MAX_LENGTH ? '…' : ''}\n[stderr]\n${stderr.slice(0, OUTPUT_SUMMARY_MAX_LENGTH)}${stderr.length > OUTPUT_SUMMARY_MAX_LENGTH ? '…' : ''}`
  } else {
    const output = stdout || stderr
    summary = output.length > OUTPUT_SUMMARY_MAX_LENGTH
      ? output.slice(0, OUTPUT_SUMMARY_MAX_LENGTH) + '…'
      : output
  }

  commandOutputs.push({
    command: command.length > COMMAND_TRUNCATE_LENGTH
      ? command.slice(0, COMMAND_TRUNCATE_LENGTH) + '…'
      : command,
    exitCode,
    summary,
    timestamp: Date.now(),
  })

  // Prune old entries
  if (commandOutputs.length > MAX_OUTPUT_HISTORY) {
    commandOutputs = commandOutputs.slice(-MAX_OUTPUT_HISTORY)
  }
}

/**
 * Capture the current terminal state.
 *
 * Called from the /terminal command or automatically triggered
 * when the user asks about terminal state.
 */
export function captureTerminalState(
  screenText?: string,
): TerminalState {
  const capabilities = detectCapabilities()

  return {
    screenContent: screenText || SCREEN_CONTENT_UNAVAILABLE,
    dimensions: {
      columns: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    },
    capabilities,
    recentOutputs: commandOutputs.slice(-10), // last 10 outputs
    timestamp: Date.now(),
  }
}

/**
 * Format terminal state as a context block for AI consumption.
 */
export function formatTerminalContext(state: TerminalState): string {
  const parts: string[] = []

  parts.push(`## Terminal State`)
  parts.push(`- **Terminal**: ${state.capabilities.terminal}`)
  parts.push(`- **Dimensions**: ${state.dimensions.columns}x${state.dimensions.rows}`)
  parts.push(`- **Color Depth**: ${state.capabilities.colorDepth}-bit`)
  parts.push(`- **Features**: sync=${state.capabilities.supportsSyncOutput}, kitty=${state.capabilities.supportsKittyProtocol}, tmux=${state.capabilities.isTmux}, ssh=${state.capabilities.isSsh}`)
  parts.push('')

  if (state.recentOutputs.length > 0) {
    parts.push('## Recent Command Outputs')
    for (const output of state.recentOutputs.slice(-5)) {
      const status = output.exitCode === 0 ? '✓' : '✗'
      parts.push(`- ${status} \`${output.command.slice(0, 100)}\``)
      if (output.summary) {
        parts.push(`  \`\`\`\n${output.summary}\n\`\`\``)
      }
    }
    parts.push('')
  }

  if (state.screenContent && state.screenContent !== SCREEN_CONTENT_UNAVAILABLE) {
    parts.push('## Screen Content')
    parts.push('```')
    parts.push(state.screenContent.slice(0, 4000))
    parts.push('```')
    parts.push('')
  }

  return parts.join('\n')
}

/**
 * Build a context injection message for the AI.
 */
export function buildTerminalContextMessage(state: TerminalState): string {
  const context = formatTerminalContext(state)
  return `\n${context}\nNote: This terminal state was captured at ${new Date(state.timestamp).toISOString()}. Use it to understand the current environment.`
}

/**
 * Detect terminal capabilities from environment and system.
 */
function detectCapabilities(): TerminalCapabilities {
  const term = process.env.TERM || 'unknown'
  const termProgram = process.env.TERM_PROGRAM || ''
  const kittyWindowId = process.env.KITTY_WINDOW_ID
  const tmux = process.env.TMUX

  // Determine terminal emulator
  let terminal = 'unknown'
  if (termProgram === 'iTerm.app') terminal = 'iTerm2'
  else if (termProgram === 'Apple_Terminal') terminal = 'Apple Terminal'
  else if (termProgram === 'vscode') terminal = 'VS Code'
  else if (kittyWindowId) terminal = 'Kitty'
  else if (process.env.WEZTERM_EXECUTABLE) terminal = 'WezTerm'
  else if (process.env.WT_SESSION) terminal = 'Windows Terminal'
  else if (process.env.GHOSTTY_RESOURCES_DIR) terminal = 'Ghostty'
  else if (process.env.ALACRITTY_LOG) terminal = 'Alacritty'

  // Color depth detection
  const colorTerm = process.env.COLORTERM || ''
  let colorDepth = 8
  if (colorTerm === 'truecolor' || colorTerm === '24bit') colorDepth = 24
  else if (colorTerm === '256color') colorDepth = 8
  else {
    const termColor = term.toLowerCase()
    if (termColor.includes('256color')) colorDepth = 8
    else if (termColor.includes('-color')) colorDepth = 8
  }

  return {
    terminal,
    supportsSyncOutput: ['iTerm2', 'WezTerm', 'Kitty', 'Ghostty', 'Windows Terminal', 'Alacritty'].includes(terminal),
    supportsProgressReporting: ['iTerm2', 'Ghostty'].includes(terminal),
    supportsExtendedKeys: ['iTerm2', 'Kitty', 'WezTerm', 'Ghostty'].includes(terminal),
    supportsKittyProtocol: ['Kitty', 'WezTerm', 'Ghostty'].includes(terminal),
    isTmux: !!tmux,
    isSsh: !!process.env.SSH_TTY || !!process.env.SSH_CLIENT,
    colorDepth,
  }
}

/**
 * Get a quick terminal status summary (lightweight, no scanning).
 */
export function getTerminalStatus(): string {
  const caps = detectCapabilities()
  const dim = `${process.stdout.columns || '?'}x${process.stdout.rows || '?'}`

  return `${caps.terminal} ${dim} ${caps.colorDepth}bit` +
    (caps.isTmux ? ' [tmux]' : '') +
    (caps.isSsh ? ' [ssh]' : '') +
    ` | ${commandOutputs.length} outputs tracked`
}

/**
 * Clear command output history.
 */
export function clearTerminalHistory(): void {
  commandOutputs = []
  logForDebugging('[terminal-awareness] History cleared')
}
