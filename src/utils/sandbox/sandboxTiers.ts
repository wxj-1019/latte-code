/**
 * Sandbox Isolation Tiers.
 *
 * Aligns latte-code's sandbox with Codex CLI's 4-tier isolation model.
 * The existing sandbox infrastructure (@anthropic-ai/sandbox-runtime) already
 * provides bubblewrap+Seatbelt kernel-level isolation. This module adds an
 * explicit tiered model for clarity and user-facing configuration.
 *
 * Tiers (ascending freedom):
 *   LEVEL_0 (read-only)      → Read-only filesystem, no network
 *   LEVEL_1 (workspace-write) → Write within workspace, no network
 *   LEVEL_2 (disk-access)     → Full disk access, no network by default
 *   LEVEL_3 (danger-full)     → No restrictions (sandbox disabled)
 *
 * Each tier maps to a set of sandbox configuration presets. Users can also
 * define custom profiles with granular overrides.
 */

import type { SandboxSettings } from '../../entrypoints/sandboxTypes.js'

// ═════════════════════════════════════════
// Tier Definitions
// ═════════════════════════════════════════

export enum SandboxTier {
  /** Read-only filesystem, no network — safest for untrusted code execution */
  READ_ONLY = 0,
  /** Write within workspace only, no network — safe for most coding tasks */
  WORKSPACE_WRITE = 1,
  /** Full disk access, network restricted — for system-level operations */
  DISK_ACCESS = 2,
  /** No restrictions — use with caution */
  DANGER_FULL = 3,
}

export interface TierProfile {
  tier: SandboxTier
  label: string
  description: string
  /** Emoji for UI display */
  icon: string
  preset: Partial<SandboxSettings>
}

// ═════════════════════════════════════════
// Tier Profiles
// ═════════════════════════════════════════

const TIER_PROFILES: Record<SandboxTier, TierProfile> = {
  [SandboxTier.READ_ONLY]: {
    tier: SandboxTier.READ_ONLY,
    label: 'read-only',
    description: 'Read-only filesystem, no network. Safest isolation level.',
    icon: '🔒',
    preset: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: {
        allowedDomains: [],
        allowManagedDomainsOnly: true,
        allowUnixSockets: [],
        allowAllUnixSockets: false,
        allowLocalBinding: false,
      },
      filesystem: {
        allowWrite: [],
        denyWrite: ['/'],
        denyRead: [],
        allowRead: [],
        allowManagedReadPathsOnly: false,
      },
    },
  },

  [SandboxTier.WORKSPACE_WRITE]: {
    tier: SandboxTier.WORKSPACE_WRITE,
    label: 'workspace-write',
    description: 'Write within workspace only, no network. Recommended for coding.',
    icon: '📁',
    preset: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: {
        allowedDomains: [],
        allowManagedDomainsOnly: false,
        allowUnixSockets: [],
        allowAllUnixSockets: false,
        allowLocalBinding: true,
      },
      filesystem: {
        allowWrite: [],  // workspace path added dynamically
        denyWrite: [],
        denyRead: [],
        allowRead: [],
        allowManagedReadPathsOnly: false,
      },
    },
  },

  [SandboxTier.DISK_ACCESS]: {
    tier: SandboxTier.DISK_ACCESS,
    label: 'disk-access',
    description: 'Full disk access, network restricted. For system-level operations.',
    icon: '💾',
    preset: {
      enabled: true,
      failIfUnavailable: false,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: true,
      network: {
        allowedDomains: [],  // user-configured per task
        allowManagedDomainsOnly: false,
        allowUnixSockets: [],
        allowAllUnixSockets: false,
        allowLocalBinding: true,
      },
      filesystem: {
        allowWrite: [],
        denyWrite: [],
        denyRead: [],
        allowRead: [],
        allowManagedReadPathsOnly: false,
      },
    },
  },

  [SandboxTier.DANGER_FULL]: {
    tier: SandboxTier.DANGER_FULL,
    label: 'danger-full',
    description: 'No sandbox restrictions. Use only for trusted operations.',
    icon: '⚠️',
    preset: {
      enabled: false,  // effectively disabled
      failIfUnavailable: false,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: true,
      network: {
        allowedDomains: [],
        allowManagedDomainsOnly: false,
        allowUnixSockets: [],
        allowAllUnixSockets: true,
        allowLocalBinding: true,
      },
      filesystem: {
        allowWrite: [],
        denyWrite: [],
        denyRead: [],
        allowRead: [],
        allowManagedReadPathsOnly: false,
      },
    },
  },
}

// ═════════════════════════════════════════
// Public API
// ═════════════════════════════════════════

/**
 * Get all tier profiles for display/enumeration.
 */
export function getAllTierProfiles(): TierProfile[] {
  return Object.values(TIER_PROFILES)
}

/**
 * Get a specific tier profile by tier level.
 */
export function getTierProfile(tier: SandboxTier): TierProfile {
  return TIER_PROFILES[tier]
}

/**
 * Get the default tier for a given context.
 *
 * Returns WORKSPACE_WRITE as the recommended default for coding tasks.
 * Returns READ_ONLY for untrusted/unverified operations.
 */
export function getDefaultTier(
  context: 'coding' | 'untrusted' | 'system' = 'coding',
): SandboxTier {
  switch (context) {
    case 'untrusted':
      return SandboxTier.READ_ONLY
    case 'system':
      return SandboxTier.DISK_ACCESS
    case 'coding':
    default:
      return SandboxTier.WORKSPACE_WRITE
  }
}

/**
 * Build a SandboxSettings object for a given tier with workspace path injection.
 */
export function buildTierSettings(
  tier: SandboxTier,
  workspacePath?: string,
  networkDomains?: string[],
): Partial<SandboxSettings> {
  const profile = getTierProfile(tier)
  const settings = structuredClone(profile.preset)

  // Inject workspace path for write access in LEVEL_1
  if (tier === SandboxTier.WORKSPACE_WRITE && workspacePath) {
    settings.filesystem = {
      ...settings.filesystem,
      allowWrite: [workspacePath],
    }
  }

  // Inject network domains if provided
  if (networkDomains && networkDomains.length > 0) {
    settings.network = {
      ...settings.network,
      allowedDomains: networkDomains,
    }
  }

  return settings
}

/**
 * Get the human-readable label for a tier.
 */
export function getTierLabel(tier: SandboxTier): string {
  return getTierProfile(tier).label
}

/**
 * Get the icon for a tier.
 */
export function getTierIcon(tier: SandboxTier): string {
  return getTierProfile(tier).icon
}

/**
 * Check if a tier is supported on the current platform.
 *
 * macOS: All tiers supported (Seatbelt built-in)
 * Linux/WSL2: All tiers supported (bubblewrap + seccomp)
 * Windows native: Only DANGER_FULL (no kernel sandbox available)
 * WSL1: Only DANGER_FULL
 */
export function isTierSupportedOnPlatform(tier: SandboxTier): boolean {
  const platform = process.platform

  // macOS and Linux/WSL2 support all tiers
  if (platform === 'darwin' || platform === 'linux') {
    return true
  }

  // Windows native only supports DANGER_FULL (no sandbox)
  if (tier === SandboxTier.DANGER_FULL) {
    return true
  }

  return false
}

// ═════════════════════════════════════════
// Statistics
// ═════════════════════════════════════════

interface TierUsageStats {
  currentTier: SandboxTier
  timesChanged: number
  tierHistory: Array<{ tier: SandboxTier; timestamp: number; reason: string }>
}

let tierStats: TierUsageStats = {
  currentTier: SandboxTier.WORKSPACE_WRITE,
  timesChanged: 0,
  tierHistory: [],
}

export function recordTierChange(tier: SandboxTier, reason: string): void {
  tierStats.currentTier = tier
  tierStats.timesChanged++
  tierStats.tierHistory.push({
    tier,
    timestamp: Date.now(),
    reason,
  })

  // Keep history bounded
  if (tierStats.tierHistory.length > 100) {
    tierStats.tierHistory = tierStats.tierHistory.slice(-50)
  }
}

export function getTierStats(): Readonly<{
  currentTier: SandboxTier
  currentLabel: string
  timesChanged: number
}> {
  return {
    currentTier: tierStats.currentTier,
    currentLabel: getTierLabel(tierStats.currentTier),
    timesChanged: tierStats.timesChanged,
  }
}
