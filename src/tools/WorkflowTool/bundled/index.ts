/**
 * Bundled workflow initializer.
 *
 * Called at module load time (before WorkflowTool is returned) to register
 * any built-in workflow scripts. For now, the only "bundled" workflow is the
 * null workflow — custom workflows are loaded dynamically from
 * .claude/workflows/ at execution time.
 */
/**
 * TODO(Phase 2): Register built-in workflow scripts here.
 * Custom workflows are loaded dynamically from .claude/workflows/ at runtime.
 */
export function initBundledWorkflows(): void {
  // Phase 2: registerBuiltinWorkflow('script-name', workflowScript)
}
