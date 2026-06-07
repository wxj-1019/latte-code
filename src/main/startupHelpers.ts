import { feature } from 'bun:bundle';
import { isAnalyticsDisabled } from 'src/services/analytics/config.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { getInitialMainLoopModel, getIsNonInteractiveSession, getSdkBetas } from '../bootstrap/state.js';
import { isRunningWithBun } from '../utils/bundledMode.js';
import { isAutoUpdaterDisabled, saveGlobalConfig, getGlobalConfig } from '../utils/config.js';
import { getContextWindowForModel } from '../utils/context.js';
import { getCwd } from '../utils/cwd.js';
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js';
import { hasNodeOption } from '../utils/envUtils.js';
import { getIsGit, getWorktreeCount } from '../utils/git.js';
import { getGhAuthStatus } from '../utils/github/ghAuthStatus.js';
import { logError } from '../utils/log.js';
import { getDefaultMainLoopModel, parseUserSpecifiedModel } from '../utils/model/model.js';
import { getManagedPluginNames } from '../utils/plugins/managedPlugins.js';
import { getPluginSeedDirs } from '../utils/plugins/pluginDirectories.js';
import { loadAllPluginsCacheOnly } from '../utils/plugins/pluginLoader.js';
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js';
import { getInitialSettings, getManagedSettingsKeysForLogging, getSettingsForSource } from '../utils/settings/settings.js';
import { logPluginLoadErrors, logPluginsEnabledForSession } from '../utils/telemetry/pluginTelemetry.js';
import { logSkillsLoaded } from '../utils/telemetry/skillLoadedEvent.js';
import { migrateChangelogFromConfig } from '../utils/releaseNotes.js';
import { migrateAutoUpdatesToSettings } from '../migrations/migrateAutoUpdatesToSettings.js';
import { migrateBypassPermissionsAcceptedToSettings } from '../migrations/migrateBypassPermissionsAcceptedToSettings.js';
import { migrateEnableAllProjectMcpServersToSettings } from '../migrations/migrateEnableAllProjectMcpServersToSettings.js';
import { migrateFennecToOpus } from '../migrations/migrateFennecToOpus.js';
import { migrateLegacyOpusToCurrent } from '../migrations/migrateLegacyOpusToCurrent.js';
import { migrateOpusToOpus1m } from '../migrations/migrateOpusToOpus1m.js';
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from '../migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js';
import { migrateSonnet1mToSonnet45 } from '../migrations/migrateSonnet1mToSonnet45.js';
import { migrateSonnet45ToSonnet46 } from '../migrations/migrateSonnet45ToSonnet46.js';
import { resetAutoModeOptInForDefaultOffer } from '../migrations/resetAutoModeOptInForDefaultOffer.js';
import { resetProToOpusDefault } from '../migrations/resetProToOpusDefault.js';

/**
 * Log managed settings keys to Statsig for analytics.
 * This is called after init() completes to ensure settings are loaded
 * and environment variables are applied before model resolution.
 */
export function logManagedSettings(): void {
  try {
    const policySettings = getSettingsForSource('policySettings');
    if (policySettings) {
      const allKeys = getManagedSettingsKeysForLogging(policySettings);
      logEvent('tengu_managed_settings_loaded', {
        keyCount: allKeys.length,
        keys: allKeys.join(',') as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  } catch {
    // Silently ignore errors - this is just for analytics
  }
}

// Check if running in debug/inspection mode
export function isBeingDebugged() {
  const isBun = isRunningWithBun();

  // Check for inspect flags in process arguments (including all variants)
  const hasInspectArg = process.execArgv.some(arg => {
    if (isBun) {
      // Note: Bun has an issue with single-file executables where application arguments
      // from process.argv leak into process.execArgv (similar to https://github.com/oven-sh/bun/issues/11673)
      // This breaks use of --debug mode if we omit this branch
      // We're fine to skip that check, because Bun doesn't support Node.js legacy --debug or --debug-brk flags
      return /--inspect(-brk)?/.test(arg);
    } else {
      // In Node.js, check for both --inspect and legacy --debug flags
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg);
    }
  });

  // Check if NODE_OPTIONS contains inspect flags
  const hasInspectEnv = process.env.NODE_OPTIONS && /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS);

  // Check if inspector is available and active (indicates debugging)
  try {
    // Dynamic import would be better but is async - use global object instead
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspector = (global as any).require('inspector');
    const hasInspectorUrl = !!inspector.url();
    return hasInspectorUrl || hasInspectArg || hasInspectEnv;
  } catch {
    // Ignore error and fall back to argument detection
    return hasInspectArg || hasInspectEnv;
  }
}

/**
 * Per-session skill/plugin telemetry. Called from both the interactive path
 * and the headless -p path (before runHeadless) — both go through
 * main.tsx but branch before the interactive startup path, so it needs two
 * call sites here rather than one here + one in QueryEngine.
 */
export function logSessionTelemetry(): void {
  const model = parseUserSpecifiedModel(getInitialMainLoopModel() ?? getDefaultMainLoopModel());
  void logSkillsLoaded(getCwd(), getContextWindowForModel(model, getSdkBetas()));
  void loadAllPluginsCacheOnly().then(({
    enabled,
    errors
  }) => {
    const managedNames = getManagedPluginNames();
    logPluginsEnabledForSession(enabled, managedNames, getPluginSeedDirs());
    logPluginLoadErrors(errors, managedNames);
  }).catch(err => logError(err));
}

export function getCertEnvVarTelemetry(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (process.env.NODE_EXTRA_CA_CERTS) {
    result.has_node_extra_ca_certs = true;
  }
  if (process.env.CLAUDE_CODE_CLIENT_CERT) {
    result.has_client_cert = true;
  }
  if (hasNodeOption('--use-system-ca')) {
    result.has_use_system_ca = true;
  }
  if (hasNodeOption('--use-openssl-ca')) {
    result.has_use_openssl_ca = true;
  }
  return result;
}

export async function logStartupTelemetry(): Promise<void> {
  if (isAnalyticsDisabled()) return;
  const [isGit, worktreeCount, ghAuthStatus] = await Promise.all([getIsGit(), getWorktreeCount(), getGhAuthStatus()]);
  logEvent('tengu_startup_telemetry', {
    is_git: isGit,
    worktree_count: worktreeCount,
    gh_auth_status: ghAuthStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sandbox_enabled: SandboxManager.isSandboxingEnabled(),
    are_unsandboxed_commands_allowed: SandboxManager.areUnsandboxedCommandsAllowed(),
    is_auto_bash_allowed_if_sandbox_enabled: SandboxManager.isAutoAllowBashIfSandboxedEnabled(),
    auto_updater_disabled: isAutoUpdaterDisabled(),
    prefers_reduced_motion: getInitialSettings().prefersReducedMotion ?? false,
    ...getCertEnvVarTelemetry()
  });
}

// @[MODEL LAUNCH]: Consider any migrations you may need for model strings. See migrateSonnet1mToSonnet45.ts for an example.
// Bump this when adding a new sync migration so existing users re-run the set.
export const CURRENT_MIGRATION_VERSION = 11;

export function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings();
    migrateBypassPermissionsAcceptedToSettings();
    migrateEnableAllProjectMcpServersToSettings();
    resetProToOpusDefault();
    migrateSonnet1mToSonnet45();
    migrateLegacyOpusToCurrent();
    migrateSonnet45ToSonnet46();
    migrateOpusToOpus1m();
    migrateReplBridgeEnabledToRemoteControlAtStartup();
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer();
    }
    if ("external" === 'ant') {
      migrateFennecToOpus();
    }
    saveGlobalConfig(prev => prev.migrationVersion === CURRENT_MIGRATION_VERSION ? prev : {
      ...prev,
      migrationVersion: CURRENT_MIGRATION_VERSION
    });
  }
  // Async migration - fire and forget since it's non-blocking
  migrateChangelogFromConfig().catch(() => {
    // Silently ignore migration errors - will retry on next startup
  });
}
