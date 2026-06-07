/**
 * Nudge Engine configuration — dual gating (compile-time feature flag +
 * runtime GrowthBook), following the skillImprovement pattern.
 */

import { feature } from 'bun:bundle'
import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export type NudgeConfig = {
  /** Turn count threshold to trigger auto-skill extraction */
  turnThreshold: number
  /** Number of non-read-only tools before triggering */
  toolComplexityThreshold: number
  /** Minimum turns between consecutive nudges (debounce) */
  minTurnsBetweenNudges: number
  /** Maximum skill extractions per session */
  maxPerSession: number
}

const DEFAULTS: NudgeConfig = {
  turnThreshold: 8,
  toolComplexityThreshold: 3,
  minTurnsBetweenNudges: 4,
  maxPerSession: 3,
}

/**
 * Whether the Nudge Engine should run.
 * Dual gate:
 * 1. Compile-time: feature('NUDGE_ENGINE') — dead-code elimination
 * 2. Runtime: GrowthBook feature flag 'tengu_nudge_engine'
 * 3. User settings: nudgeEngineEnabled in settings.json
 *
 * Mirrors isAutoDreamEnabled() pattern in autoDream/config.ts.
 */
export function isNudgeEngineEnabled(): boolean {
  if (!feature('NUDGE_ENGINE')) return false
  if (!isAutoMemoryEnabled()) return false

  const settings = getInitialSettings()
  if (settings.nudgeEngineEnabled !== undefined) {
    return settings.nudgeEngineEnabled
  }

  // GrowthBook runtime kill switch — same pattern as skillImprovement:
  //   getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_panda', false)
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_nudge_engine', false)
}

/**
 * Returns the merged nudge configuration.
 * User settings (settings.json) override GrowthBook-controlled defaults.
 */
export function getNudgeEngineConfig(): NudgeConfig {
  const settings = getInitialSettings()
  return {
    turnThreshold: settings.nudgeEngineTurnThreshold ?? DEFAULTS.turnThreshold,
    toolComplexityThreshold: DEFAULTS.toolComplexityThreshold,
    minTurnsBetweenNudges: DEFAULTS.minTurnsBetweenNudges,
    maxPerSession: settings.nudgeEngineMaxPerSession ?? DEFAULTS.maxPerSession,
  }
}
