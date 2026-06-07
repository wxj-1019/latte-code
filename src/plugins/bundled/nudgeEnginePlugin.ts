/**
 * Built-in Plugin: Auto-Learning (Nudge Engine)
 *
 * Automatically detects repeatable multi-step patterns in your workflow
 * and captures them as reusable skills. Runs in the background without
 * interrupting your work.
 *
 * Plugin ID: nudge-engine@builtin
 */
import type { BuiltinPluginDefinition } from '../../types/plugin.js'

export const nudgeEnginePlugin: BuiltinPluginDefinition = {
  name: 'Auto-Learning Engine',
  description:
    'Automatically detects repeatable patterns in your workflow and captures them as reusable skills. ' +
    'Fire-and-forget — never blocks your main conversation.',
  version: '1.0.0',
  defaultEnabled: true,
}
