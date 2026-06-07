/**
 * Built-in Plugin: Smart Approvals
 *
 * Three-tier safety guardian that automatically classifies operations:
 *   - Silent Approve: safe operations (git status, reading files)
 *   - Escalate: suspicious operations (writing outside workspace)
 *   - Block: dangerous operations (sudo, curl pipe bash)
 *
 * Plugin ID: smart-approvals@builtin
 */
import type { BuiltinPluginDefinition } from '../../types/plugin.js'

export const smartApprovalsPlugin: BuiltinPluginDefinition = {
  name: 'Smart Approvals',
  description:
    'Three-tier AI guardian for automatic operation classification. ' +
    'Silently approves safe operations, escalates suspicious ones, and auto-blocks dangerous ones — ' +
    'reducing unnecessary permission prompts without sacrificing safety.',
  version: '1.0.0',
  defaultEnabled: true,
}
