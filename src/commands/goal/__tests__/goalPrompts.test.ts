import { describe, it, expect } from 'vitest'
import {
  buildGoalContinuationPrompt,
  buildGoalBudgetLimitPrompt,
  buildGoalCompletePrompt,
  buildGoalSuppressionPrompt,
  buildGoalEvaluatorPrompt,
  buildGoalInitialPrompt,
} from '../goalPrompts.js'
import type { Goal } from '../goalState.js'

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

  describe('buildGoalCompletePrompt', () => {
    it('should include completion message', () => {
      const goal = makeGoal({ status: 'complete', turnsUsed: 5 })
      const prompt = buildGoalCompletePrompt(goal)
      expect(prompt).toContain('COMPLETED')
      expect(prompt).toContain('fix all bugs')
      expect(prompt).toContain('5/10')
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
})
