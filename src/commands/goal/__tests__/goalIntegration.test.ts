import { describe, it, expect, beforeEach } from 'vitest'
import {
  setGoal,
  getGoal,
  clearGoal,
  incrementTurn,
  resetZeroToolCallCounter,
  initReflection,
  shouldReflect,
  recordReflection,
  recordStrategyChange,
  getReflectionPrompt,
  setSubtasks,
  getNextSubtask,
  updateSubtaskStatus,
  getSubtaskProgress,
  updateExecutionPlan,
  markStepCompleted,
  getExecutionProgress,
  recordStepFailure,
  getErrorRecoveryHint,
  recordCompact,
  getCompactStatus,
  getGoalSummary,
  addTokensSpent,
  formatGoalStatus,
  markGoalComplete,
  isGoalActive,
} from '../goalState.js'
import {
  buildGoalInitialPrompt,
  buildGoalContinuationPrompt,
  buildGoalBudgetLimitPrompt,
} from '../goalPrompts.js'

describe('Goal Integration Tests', () => {
  beforeEach(() => {
    clearGoal()
    resetZeroToolCallCounter()
  })

  describe('Full workflow simulation', () => {
    it('should simulate a complete goal workflow with all features', () => {
      // 1. Set a goal
      const goal = setGoal('Implement user authentication system', 20)
      expect(goal.objective).toBe('Implement user authentication system')
      expect(goal.status).toBe('active')

      // 2. Initialize reflection
      initReflection(5)

      // 3. Set execution plan
      updateExecutionPlan([
        'Research existing auth patterns',
        'Design auth schema',
        'Implement login endpoint',
        'Implement registration endpoint',
        'Add password hashing',
        'Write tests',
      ])

      // 4. Set subtasks
      setSubtasks([
        'Analyze requirements',
        'Create database schema',
        'Build API endpoints',
        'Add security measures',
        'Write documentation',
      ])

      // 5. Simulate execution over multiple turns
      // Turn 1-2: Research phase
      incrementTurn()
      incrementTurn()
      markStepCompleted(0) // Research done
      updateSubtaskStatus(0, 'completed', 'Requirements analyzed')

      // Turn 3-4: Design phase
      incrementTurn()
      incrementTurn()
      markStepCompleted(1) // Design done
      updateSubtaskStatus(1, 'completed', 'Schema created')

      // Turn 5: First reflection point
      incrementTurn()
      expect(shouldReflect()).toBe(true)
      const reflectionPrompt = getReflectionPrompt()
      expect(reflectionPrompt).toContain('SELF-REFLECTION REQUIRED')
      recordReflection('Design phase completed successfully, moving to implementation')

      // Turn 6-8: Implementation
      incrementTurn()
      incrementTurn()
      incrementTurn()
      markStepCompleted(2) // Login endpoint
      markStepCompleted(3) // Registration endpoint
      updateSubtaskStatus(2, 'completed', 'API endpoints built')

      // Turn 9: Error occurs
      incrementTurn()
      recordStepFailure(4, 'bcrypt import failed')
      const errorHint = getErrorRecoveryHint()
      expect(errorHint).toContain('bcrypt import failed')

      // Turn 10: Error recovery
      incrementTurn()
      markStepCompleted(4) // Password hashing fixed
      updateSubtaskStatus(3, 'completed', 'Security added')

      // Simulate context compression
      recordCompact('Compacted 50000 → 20000 tokens')
      expect(getCompactStatus()).toContain('1 times')

      // Turn 11-12: Testing
      incrementTurn()
      incrementTurn()
      markStepCompleted(5) // Tests done
      updateSubtaskStatus(4, 'completed', 'Documentation written')

      // 6. Verify final state
      const progress = getExecutionProgress()
      expect(progress).toContain('[x] Research existing auth patterns')
      expect(progress).toContain('[x] Write tests')

      const subtaskProgress = getSubtaskProgress()
      expect(subtaskProgress).toContain('[x] Analyze requirements')
      expect(subtaskProgress).toContain('[x] Build API endpoints')

      const summary = getGoalSummary()
      expect(summary).toContain('Implement user authentication system')
      expect(summary).toContain('6/6 steps')

      // 7. Complete goal
      markGoalComplete()
      expect(isGoalActive()).toBe(false)
    })

    it('should generate appropriate prompts at each stage', () => {
      setGoal('Fix all bugs in the codebase', 15)
      initReflection(3)
      updateExecutionPlan(['Find bugs', 'Fix bugs', 'Verify fixes'])
      setSubtasks(['Run linter', 'Fix critical bugs', 'Run tests'])

      // Initial prompt should include workflow
      const initialPrompt = buildGoalInitialPrompt('Fix all bugs', 15)
      expect(initialPrompt).toContain('RESEARCH PHASE')
      expect(initialPrompt).toContain('PLAN PHASE')
      expect(initialPrompt).toContain('EXECUTE PHASE')

      // Continuation prompt should include progress
      incrementTurn()
      incrementTurn()
      markStepCompleted(0)
      updateSubtaskStatus(0, 'completed')

      const continuationPrompt = buildGoalContinuationPrompt(getGoal()!)
      expect(continuationPrompt).toContain('Fix all bugs in the codebase')
      expect(continuationPrompt).toContain('2/15')
      expect(continuationPrompt).toContain('[x] Find bugs')

      // Budget limit prompt
      const budgetPrompt = buildGoalBudgetLimitPrompt(getGoal()!)
      expect(budgetPrompt).toContain('BUDGET EXHAUSTED')
    })

    it('should handle complex dependency chains in subtasks', () => {
      setGoal('Build a full-stack app')
      setSubtasks([
        'Setup project',        // 0: no deps
        'Create database',      // 1: depends on 0
        'Build backend',        // 2: depends on 1
        'Build frontend',       // 3: depends on 0
        'Integration testing',  // 4: depends on 2, 3
      ])

      // First task available
      let next = getNextSubtask()
      expect(next!.description).toBe('Setup project')

      // Complete first task
      updateSubtaskStatus(0, 'completed')

      // Now tasks 1 and 3 are available (both depend on 0)
      next = getNextSubtask()
      expect(next!.description).toBe('Create database')

      // Complete task 1
      updateSubtaskStatus(1, 'completed')

      // Task 2 now available
      next = getNextSubtask()
      expect(next!.description).toBe('Build backend')

      // Complete task 2
      updateSubtaskStatus(2, 'completed')

      // Task 3 still available (was waiting)
      next = getNextSubtask()
      expect(next!.description).toBe('Build frontend')

      // Complete task 3
      updateSubtaskStatus(3, 'completed')

      // Task 4 now available (deps 2 and 3 completed)
      next = getNextSubtask()
      expect(next!.description).toBe('Integration testing')
    })

    it('should track token usage and resource warnings', () => {
      const goal = setGoal('Optimize performance', 10)
      initReflection(5)

      // Simulate token usage
      addTokensSpent(50000)
      addTokensSpent(30000)

      expect(getGoal()!.tokensSpent).toBe(80000)

      // Simulate turns with resource warnings
      for (let i = 0; i < 6; i++) {
        incrementTurn()
      }

      // At 60% should have notice
      const prompt60 = buildGoalContinuationPrompt(getGoal()!)
      expect(prompt60).toContain('60% turns used')

      // Continue to 80%
      for (let i = 0; i < 2; i++) {
        incrementTurn()
      }

      const prompt80 = buildGoalContinuationPrompt(getGoal()!)
      expect(prompt80).toContain('80% turns used')
    })

    it('should handle reflection and strategy changes', () => {
      setGoal('Implement feature X')
      initReflection(3)

      // Turn 1-3
      incrementTurn()
      incrementTurn()
      incrementTurn()

      // Should reflect
      expect(shouldReflect()).toBe(true)
      recordReflection('Current approach is too slow')
      recordStrategyChange('Switching to parallel execution')

      // After reflection, interval resets
      expect(shouldReflect()).toBe(false)

      // Turn 4-6
      incrementTurn()
      incrementTurn()
      incrementTurn()

      // Should reflect again
      expect(shouldReflect()).toBe(true)
      const prompt = getReflectionPrompt()
      expect(prompt).toContain('SELF-REFLECTION REQUIRED')

      // Record new reflection
      recordReflection('Parallel execution working better')
      recordStrategyChange('Added caching layer')

      const goal = getGoal()!
      expect(goal.reflections).toHaveLength(2)
      expect(goal.strategyChanges).toHaveLength(2)
    })

    it('should format goal status correctly with all features', () => {
      setGoal('Complete project', 20)
      initReflection(5)
      updateExecutionPlan(['Step 1', 'Step 2', 'Step 3'])
      setSubtasks(['Task A', 'Task B'])

      incrementTurn()
      incrementTurn()
      markStepCompleted(0)
      updateSubtaskStatus(0, 'completed')
      addTokensSpent(25000)
      recordCompact('Initial compact')

      const status = formatGoalStatus()
      expect(status).toContain('Complete project')
      expect(status).toContain('active')
      expect(status).toContain('2/20')
      expect(status).toContain('25.0k tokens')
    })
  })
})
