/**
 * Sandbox tier tests.
 *
 * Tests the 4-tier isolation model:
 *   LEVEL_0 (read-only) → LEVEL_1 (workspace-write)
 *   → LEVEL_2 (disk-access) → LEVEL_3 (danger-full)
 */
import { describe, it, expect } from 'vitest'
import {
  SandboxTier,
  getAllTierProfiles,
  getTierProfile,
  getDefaultTier,
  buildTierSettings,
  getTierLabel,
  getTierIcon,
  recordTierChange,
  getTierStats,
} from '../sandboxTiers.js'

describe('Sandbox Tiers', () => {
  describe('Tier Profiles', () => {
    it('should have exactly 4 profiles', () => {
      const profiles = getAllTierProfiles()
      expect(profiles).toHaveLength(4)
    })

    it('should have unique labels', () => {
      const profiles = getAllTierProfiles()
      const labels = profiles.map(p => p.label)
      const uniqueLabels = new Set(labels)
      expect(uniqueLabels.size).toBe(4)
    })

    it('should have correct tier values', () => {
      expect(getTierProfile(SandboxTier.READ_ONLY).tier).toBe(0)
      expect(getTierProfile(SandboxTier.WORKSPACE_WRITE).tier).toBe(1)
      expect(getTierProfile(SandboxTier.DISK_ACCESS).tier).toBe(2)
      expect(getTierProfile(SandboxTier.DANGER_FULL).tier).toBe(3)
    })
  })

  describe('Default Tier Selection', () => {
    it('should default to WORKSPACE_WRITE for coding context', () => {
      expect(getDefaultTier('coding')).toBe(SandboxTier.WORKSPACE_WRITE)
    })

    it('should use READ_ONLY for untrusted context', () => {
      expect(getDefaultTier('untrusted')).toBe(SandboxTier.READ_ONLY)
    })

    it('should use DISK_ACCESS for system context', () => {
      expect(getDefaultTier('system')).toBe(SandboxTier.DISK_ACCESS)
    })

    it('should default to coding/WORKSPACE_WRITE when no context provided', () => {
      expect(getDefaultTier()).toBe(SandboxTier.WORKSPACE_WRITE)
    })
  })

  describe('Tier Labels and Icons', () => {
    it('should return correct labels', () => {
      expect(getTierLabel(SandboxTier.READ_ONLY)).toBe('read-only')
      expect(getTierLabel(SandboxTier.WORKSPACE_WRITE)).toBe('workspace-write')
      expect(getTierLabel(SandboxTier.DISK_ACCESS)).toBe('disk-access')
      expect(getTierLabel(SandboxTier.DANGER_FULL)).toBe('danger-full')
    })

    it('should return non-empty icons', () => {
      expect(getTierIcon(SandboxTier.READ_ONLY).length).toBeGreaterThan(0)
      expect(getTierIcon(SandboxTier.WORKSPACE_WRITE).length).toBeGreaterThan(0)
      expect(getTierIcon(SandboxTier.DISK_ACCESS).length).toBeGreaterThan(0)
      expect(getTierIcon(SandboxTier.DANGER_FULL).length).toBeGreaterThan(0)
    })
  })

  describe('buildTierSettings', () => {
    it('should build settings with workspace injection for LEVEL_1', () => {
      const settings = buildTierSettings(
        SandboxTier.WORKSPACE_WRITE,
        '/home/user/project',
      )

      expect(settings.enabled).toBe(true)
      expect(settings.filesystem?.allowWrite).toContain('/home/user/project')
    })

    it('should inject network domains when provided', () => {
      const settings = buildTierSettings(
        SandboxTier.DISK_ACCESS,
        undefined,
        ['github.com', 'api.example.com'],
      )

      expect(settings.network?.allowedDomains).toContain('github.com')
      expect(settings.network?.allowedDomains).toContain('api.example.com')
    })

    it('should set enabled=false for DANGER_FULL tier', () => {
      const settings = buildTierSettings(SandboxTier.DANGER_FULL)
      expect(settings.enabled).toBe(false)
    })

    it('should not inject workspace for non-WORKSPACE_WRITE tiers', () => {
      const settings = buildTierSettings(
        SandboxTier.READ_ONLY,
        '/some/path',
      )

      // READ_ONLY doesn't use workspace path injection
      expect(settings.filesystem?.allowWrite).toEqual([])
    })
  })

  describe('Tier Stats', () => {
    it('should track tier changes', () => {
      recordTierChange(SandboxTier.READ_ONLY, 'testing')
      recordTierChange(SandboxTier.WORKSPACE_WRITE, 'done testing')

      const stats = getTierStats()
      expect(stats.currentTier).toBe(SandboxTier.WORKSPACE_WRITE)
      expect(stats.currentLabel).toBe('workspace-write')
      expect(stats.timesChanged).toBeGreaterThanOrEqual(2)
    })
  })
})
