import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildGoalContinuationPrompt,
  buildGoalBudgetLimitPrompt,
  buildGoalSuppressionPrompt,
  buildGoalEvaluatorPrompt,
  buildGoalInitialPrompt,
} from '../goalPrompts.js'
import type { Goal } from '../goalState.js'
import { setGoal, clearGoal, setGoalVerification, setBudgetConfig, addTokensSpent } from '../goalState.js'

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal_test_123',
    objective: 'fix all bugs',
    status: 'active',
    maxTurns: 10,
    turnsUsed: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'objective',
    tokensSpent: 5000,
    startedAt: Date.now() - 60000,
    ...overrides,
  }
}

describe('goalPrompts', () => {
  beforeEach(() => {
    clearGoal()
  })

  describe('buildGoalContinuationPrompt', () => {
    it('should include objective and progress', () => {
      const goal = makeGoal()
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).toContain('fix all bugs')
      expect(prompt).toContain('3/10')
      expect(prompt).toContain('7 left')
      expect(prompt).toContain('[GOAL_COMPLETED]')
    })

    it('should include urgency prefix when few turns left', () => {
      const goal = makeGoal({ turnsUsed: 9, maxTurns: 10 })
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).toContain('[URGENT: 1 turn left - focus on completion]')
    })

    it('should not include urgency prefix when many turns left', () => {
      const goal = makeGoal({ turnsUsed: 2, maxTurns: 10 })
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).not.toContain('[URGENT]')
    })

    it('should include condition for condition-mode goals', () => {
      const goal = makeGoal({ mode: 'condition', condition: 'all tests pass' })
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).toContain('Condition: all tests pass')
    })

    it('should include evaluator reason when present', () => {
      const goal = makeGoal({ evaluatorReason: 'tests still failing' })
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).toContain('Last eval: tests still failing')
    })
  })

  describe('buildGoalBudgetLimitPrompt', () => {
    it('should include budget exhausted message', () => {
      const goal = makeGoal()
      const prompt = buildGoalBudgetLimitPrompt(goal)
      expect(prompt).toContain('BUDGET EXHAUSTED')
      expect(prompt).toContain('fix all bugs')
      expect(prompt).toContain('10 turns')
    })
  })

  describe('buildGoalSuppressionPrompt', () => {
    it('should include auto-completed message with idle turns', () => {
      const goal = makeGoal()
      const prompt = buildGoalSuppressionPrompt(goal, 3)
      expect(prompt).toContain('AUTO-COMPLETED')
      expect(prompt).toContain('fix all bugs')
      expect(prompt).toContain('3 turns')
    })
  })

  describe('buildGoalEvaluatorPrompt', () => {
    it('should use condition when available', () => {
      const goal = makeGoal({ condition: 'all tests pass' })
      const prompt = buildGoalEvaluatorPrompt(goal)
      expect(prompt).toContain('all tests pass')
      expect(prompt).toContain('COMPLETED: [YES/NO]')
    })

    it('should fall back to objective when no condition', () => {
      const goal = makeGoal({ mode: 'objective' })
      const prompt = buildGoalEvaluatorPrompt(goal)
      expect(prompt).toContain('fix all bugs')
    })
  })

  describe('buildGoalInitialPrompt', () => {
    it('should include objective and budget', () => {
      const prompt = buildGoalInitialPrompt('fix all bugs', 10)
      expect(prompt).toContain('NEW GOAL: fix all bugs')
      expect(prompt).toContain('Budget: 10 turns')
      expect(prompt).toContain('[GOAL_COMPLETED]')
    })

    it('should include condition for condition mode', () => {
      const prompt = buildGoalInitialPrompt('fix bugs', 10, 'condition', 'all tests pass')
      expect(prompt).toContain('Condition: all tests pass')
    })

    it('should not include condition section for objective mode', () => {
      const prompt = buildGoalInitialPrompt('fix bugs', 10, 'objective')
      expect(prompt).not.toContain('Condition:')
    })
  })

  describe('buildGoalContinuationPrompt - verification section', () => {
    it('should include verification status when configured', () => {
      setGoal('fix bugs', 10)
      setGoalVerification({
        commands: ['npm test'],
        maxRetries: 1,
        timeoutMs: 10000,
      })
      const goal = { ...makeGoal(), verification: { commands: ['npm test'], maxRetries: 1, timeoutMs: 10000 } }
      const prompt = buildGoalContinuationPrompt(goal)
      expect(prompt).toContain('Verification')
    })
  })

  describe('buildGoalContinuationPrompt - budget section', () => {
    it('should include budget status when configured', () => {
      setGoal('test', 10)
      setBudgetConfig({
        maxTokensTotal: 100000,
        maxCostUSD: 5.0,
        warningThresholds: { tokens: [], cost: [] },
      })
      addTokensSpent(5000)
      const goal = makeGoal({ tokensSpent: 5000 })
      // Manually set budget on the goal for the prompt test
      const goalWithBudget = { ...goal, budgetConfig: { maxTokensTotal: 100000, maxCostUSD: 5.0, warningThresholds: { tokens: [] as number[], cost: [] as number[] } } }
      const prompt = buildGoalContinuationPrompt(goalWithBudget as any)
      expect(prompt).toContain('Budget')
    })
  })

  describe('buildGoalEvaluatorPrompt - verification awareness', () => {
    it('should include verification commands in evaluator when configured', () => {
      const goal = makeGoal({
        verification: { commands: ['npm test', 'tsc --noEmit'], maxRetries: 2, timeoutMs: 30000 },
      })
      const prompt = buildGoalEvaluatorPrompt(goal)
      expect(prompt).toContain('npm test')
      expect(prompt).toContain('tsc --noEmit')
    })
  })
})
