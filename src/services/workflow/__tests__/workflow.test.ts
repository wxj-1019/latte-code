/**
 * Workflow engine tests.
 *
 * Tests the core workflow sandbox engine, agent pool, and
 * Nudge Engine integration points.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  executeWorkflowScript,
  buildWorkflowPrompt,
} from '../engine.js'
import { resetPool, getPoolStats, spawnPoolAgent, waitAllPoolAgents } from '../pool.js'
import {
  initWorkflowNudgeIntegration,
  onSkillGenerated,
  onWorkflowExecuted,
  shouldAutoExecute,
  isPoolAvailable,
  getWorkflowNudgeStats,
} from '../nudgeIntegration.js'

describe('Workflow Engine', () => {
  describe('executeWorkflowScript', () => {
    it('should execute a simple workflow script', async () => {
      const result = await executeWorkflowScript(
        'return("hello world")',
        {
          task: 'test',
          workDir: '/tmp',
        },
      )

      expect(result.finalAnswer).toBe('hello world')
      expect(result.agentsUsed).toBe(0)
    })

    it('should spawn agents and collect results', async () => {
      const result = await executeWorkflowScript(
        'spawn("a", "task A"); await waitAll(); return("done")',
        {
          task: 'test multi-agent',
          workDir: '/tmp',
        },
      )

      expect(result.finalAnswer).toBe('done')
      expect(result.agentsUsed).toBe(1)
    })

    it('should throw when return() is not called', async () => {
      await expect(
        executeWorkflowScript('const x = 1 + 1', {
          task: 'no-return',
          workDir: '/tmp',
        }),
      ).rejects.toThrow(/did not call return/)
    })

    it('should reject oversized scripts', async () => {
      const hugeScript = '// ' + 'a'.repeat(100_000)

      await expect(
        executeWorkflowScript(hugeScript, {
          task: 'oversized',
          workDir: '/tmp',
        }),
      ).rejects.toThrow(/too large/)
    })
  })

  describe('buildWorkflowPrompt', () => {
    it('should generate a valid prompt', () => {
      const prompt = buildWorkflowPrompt('test task')
      expect(prompt).toContain('Dynamic Workflow Orchestration')
      expect(prompt).toContain('test task')
      expect(prompt).toContain('spawn')
      expect(prompt).toContain('waitAll')
      expect(prompt).toContain('return')
    })

    it('should include skill info when provided', () => {
      const prompt = buildWorkflowPrompt('test', 'my-skill')
      expect(prompt).toContain('my-skill')
      expect(prompt).toContain('.claude/skills/my-skill/SKILL.md')
    })
  })
})

describe('Agent Pool', () => {
  beforeEach(() => {
    resetPool()
  })

  it('should start with empty pool', () => {
    const stats = getPoolStats()
    expect(stats.active).toBe(0)
    expect(stats.queued).toBe(0)
    expect(stats.totalSpawned).toBe(0)
  })

  it('should spawn an agent and return result', async () => {
    const result = await spawnPoolAgent({
      name: 'test-agent',
      task: 'test task',
    })

    expect(result.agentName).toBe('test-agent')
    expect(result.task).toBe('test task')
    expect(result.output).toContain('Executed successfully')
  })

  it('should track spawned agent count', async () => {
    await spawnPoolAgent({ name: 'a', task: 't' })
    const stats = getPoolStats()
    expect(stats.totalSpawned).toBe(1)
  })

  it('should drain queue with waitAllPoolAgents', async () => {
    const results = await waitAllPoolAgents()
    expect(results).toBeDefined()
  })
})

describe('Nudge Integration', () => {
  it('should initialize stats at zero', () => {
    const stats = getWorkflowNudgeStats()
    expect(stats.skillsGenerated).toBe(0)
    expect(stats.skillsExecuted).toBe(0)
    expect(stats.totalExecutions).toBe(0)
  })

  it('should track skill generation', () => {
    onSkillGenerated('test-skill')
    // Note: initWorkflowNudgeIntegration hasn't been called,
    // so this is a no-op. Test that it doesn't throw.
    expect(getWorkflowNudgeStats().skillsGenerated).toBe(0)
  })

  it('should report pool availability', () => {
    expect(isPoolAvailable()).toBe(true)
  })

  it('should disable auto-execute before sufficient executions', () => {
    // init not called
    expect(shouldAutoExecute('any-skill')).toBe(false)
  })
})
