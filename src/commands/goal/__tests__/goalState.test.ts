import { describe, it, expect, beforeEach } from 'vitest'
import {
  setGoal,
  getGoal,
  pauseGoal,
  resumeGoal,
  clearGoal,
  isGoalActive,
  isGoalPaused,
  isConditionMode,
  getGoalCondition,
  markGoalComplete,
  markGoalBudgetLimited,
  incrementTurn,
  recordToolCallPresence,
  shouldSuppressContinuation,
  getConsecutiveZeroToolCalls,
  resetZeroToolCallCounter,
  addTokensSpent,
  formatGoalStatus,
  updateEvaluatorReason,
  getGoalDurationMs,
  serializeGoal,
  deserializeGoal,
  getOriginalPermissionMode,
  setOriginalPermissionMode,
  restoreOriginalPermissionMode,
  updateExecutionPlan,
  markStepCompleted,
  getExecutionProgress,
  recordStepFailure,
  clearStepFailure,
  getErrorRecoveryHint,
  initReflection,
  shouldReflect,
  recordReflection,
  recordStrategyChange,
  getReflectionPrompt,
  setSubtasks,
  getNextSubtask,
  updateSubtaskStatus,
  getSubtaskProgress,
  recordCompact,
  getCompactStatus,
  getGoalSummary,
} from '../goalState.js'

describe('goalState', () => {
  beforeEach(() => {
    clearGoal()
    setOriginalPermissionMode(null)
    resetZeroToolCallCounter()
  })

  describe('setGoal / getGoal', () => {
    it('should create a goal with default maxTurns', () => {
      const goal = setGoal('test objective')
      expect(goal.objective).toBe('test objective')
      expect(goal.status).toBe('active')
      expect(goal.maxTurns).toBe(50)
      expect(goal.turnsUsed).toBe(0)
      expect(goal.tokensSpent).toBe(0)
    })

    it('should respect custom maxTurns', () => {
      const goal = setGoal('test', 5)
      expect(goal.maxTurns).toBe(5)
    })

    it('should clamp maxTurns to valid range', () => {
      const goal1 = setGoal('test', -1)
      expect(goal1.maxTurns).toBe(1)

      const goal2 = setGoal('test', 300)
      expect(goal2.maxTurns).toBe(200)

      const goal3 = setGoal('test', NaN)
      expect(goal3.maxTurns).toBe(50)
    })

    it('should trim the objective', () => {
      const goal = setGoal('  hello world  ')
      expect(goal.objective).toBe('hello world')
    })
  })

  describe('goal lifecycle', () => {
    it('should transition active → paused → active', () => {
      setGoal('test')
      expect(isGoalActive()).toBe(true)

      pauseGoal()
      expect(isGoalPaused()).toBe(true)
      expect(isGoalActive()).toBe(false)

      resumeGoal()
      expect(isGoalActive()).toBe(true)
      expect(isGoalPaused()).toBe(false)
    })

    it('should only pause active goals', () => {
      setGoal('test')
      markGoalComplete()
      pauseGoal()
      expect(getGoal()!.status).toBe('complete')
    })

    it('should only resume paused goals', () => {
      setGoal('test')
      resumeGoal() // already active, should not change
      expect(getGoal()!.status).toBe('active')
    })

    it('should clear the goal', () => {
      setGoal('test')
      clearGoal()
      expect(getGoal()).toBeNull()
    })

    it('should mark goal as complete', () => {
      setGoal('test')
      markGoalComplete()
      expect(getGoal()!.status).toBe('complete')
    })

    it('should mark goal as budget limited', () => {
      setGoal('test')
      markGoalBudgetLimited()
      expect(getGoal()!.status).toBe('budget_limited')
    })
  })

  describe('turn tracking', () => {
    it('should increment turnsUsed', () => {
      setGoal('test', 10)
      incrementTurn()
      expect(getGoal()!.turnsUsed).toBe(1)
      incrementTurn()
      expect(getGoal()!.turnsUsed).toBe(2)
    })

    it('should not crash when no goal is set', () => {
      expect(() => incrementTurn()).not.toThrow()
    })
  })

  describe('tool call presence tracking', () => {
    it('should reset counter on tool calls', () => {
      recordToolCallPresence(false)
      recordToolCallPresence(false)
      expect(getConsecutiveZeroToolCalls()).toBe(2)
      recordToolCallPresence(true)
      expect(getConsecutiveZeroToolCalls()).toBe(0)
    })

    it('should suppress continuation after MAX_ZERO_TOOL_CALLS', () => {
      // MAX_ZERO_TOOL_CALLS is now 5
      recordToolCallPresence(false)
      recordToolCallPresence(false)
      recordToolCallPresence(false)
      recordToolCallPresence(false)
      expect(shouldSuppressContinuation()).toBe(false)
      recordToolCallPresence(false)
      expect(shouldSuppressContinuation()).toBe(true)
    })
  })

  describe('token tracking', () => {
    it('should accumulate tokens', () => {
      setGoal('test')
      addTokensSpent(1000)
      addTokensSpent(500)
      expect(getGoal()!.tokensSpent).toBe(1500)
    })

    it('should not crash when no goal is set', () => {
      expect(() => addTokensSpent(100)).not.toThrow()
    })
  })

  describe('condition mode detection', () => {
    it('should detect explicit "when" prefix', () => {
      setGoal('when tests pass')
      expect(isConditionMode()).toBe(true)
      expect(getGoalCondition()).toBe('when tests pass')
    })

    it('should detect explicit "if" prefix', () => {
      setGoal('if build succeeds')
      expect(isConditionMode()).toBe(true)
    })

    it('should detect condition keywords', () => {
      setGoal('make all tests pass')
      expect(isConditionMode()).toBe(true)
    })

    it('should detect exit code patterns', () => {
      setGoal('check exit code 0')
      expect(isConditionMode()).toBe(true)
    })

    it('should default to objective mode', () => {
      setGoal('write a README')
      expect(isConditionMode()).toBe(false)
    })

    it('should NOT trigger on "install all dependencies" (all without test/pass context)', () => {
      setGoal('install all dependencies')
      expect(isConditionMode()).toBe(false)
    })

    it('should NOT trigger on "make a difference" (diff inside a word)', () => {
      setGoal('make a difference')
      expect(isConditionMode()).toBe(false)
    })

    it('should NOT trigger on "review the PR" without context', () => {
      // "review" alone is removed from condition keywords to reduce false positives
      setGoal('review the PR')
      expect(isConditionMode()).toBe(false)
    })

    it('should trigger on "all tests pass" (specific pattern)', () => {
      setGoal('make all tests pass')
      expect(isConditionMode()).toBe(true)
    })

    it('should trigger on "tests pass" (specific pattern)', () => {
      setGoal('ensure tests pass')
      expect(isConditionMode()).toBe(true)
    })

    it('should trigger on "git diff" (specific pattern)', () => {
      setGoal('check git diff is clean')
      expect(isConditionMode()).toBe(true)
    })
  })

  describe('formatGoalStatus', () => {
    it('should show message when no goal is active', () => {
      expect(formatGoalStatus()).toContain('No active goal')
    })

    it('should show goal info when active', () => {
      setGoal('test objective', 10)
      const status = formatGoalStatus()
      expect(status).toContain('test objective')
      expect(status).toContain('active')
      expect(status).toContain('0/10')
    })

    it('should show evaluator reason', () => {
      setGoal('test', 10)
      updateEvaluatorReason('all tests passed')
      expect(formatGoalStatus()).toContain('all tests passed')
    })

    it('should show duration', () => {
      setGoal('test', 10)
      expect(formatGoalStatus()).toContain('0s')
    })
  })

  describe('serialize / deserialize', () => {
    it('should round-trip goal state', () => {
      setGoal('test objective', 5)
      incrementTurn()
      const serialized = serializeGoal()
      expect(serialized).not.toBeNull()

      clearGoal()
      expect(getGoal()).toBeNull()

      const restored = deserializeGoal(serialized!)
      expect(restored).toBe(true)
      expect(getGoal()!.objective).toBe('test objective')
      expect(getGoal()!.maxTurns).toBe(5)
      // Counters are reset on resume
      expect(getGoal()!.turnsUsed).toBe(0)
      expect(getGoal()!.tokensSpent).toBe(0)
      expect(getGoal()!.status).toBe('active')
    })

    it('should reject invalid serialized data', () => {
      expect(deserializeGoal('')).toBe(false)
      expect(deserializeGoal('not json')).toBe(false)
      expect(deserializeGoal('null')).toBe(false)
      expect(deserializeGoal('{}')).toBe(false)
      expect(deserializeGoal(JSON.stringify({ id: '', objective: '' }))).toBe(false)
      expect(deserializeGoal(JSON.stringify({ id: '1', objective: 'x', status: 'invalid' }))).toBe(false)
    })

    it('should return null when no goal', () => {
      expect(serializeGoal()).toBeNull()
    })
  })

  describe('permission mode', () => {
    it('should track and restore original permission mode', () => {
      setOriginalPermissionMode('default')
      expect(getOriginalPermissionMode()).toBe('default')

      let appState = { toolPermissionContext: { mode: 'bypassPermissions' } }
      const setAppState = (updater: (prev: any) => any) => {
        appState = updater(appState)
      }

      restoreOriginalPermissionMode(setAppState)
      expect(appState.toolPermissionContext.mode).toBe('default')
      expect(getOriginalPermissionMode()).toBeNull()
    })

    it('should no-op when no original mode is saved', () => {
      let appState = { toolPermissionContext: { mode: 'bypassPermissions' } }
      const setAppState = (updater: (prev: any) => any) => {
        appState = updater(appState)
      }

      restoreOriginalPermissionMode(setAppState)
      expect(appState.toolPermissionContext.mode).toBe('bypassPermissions')
    })
  })

  describe('evaluatorReason', () => {
    it('should update evaluator reason', () => {
      setGoal('test')
      updateEvaluatorReason('condition met')
      expect(getGoal()!.evaluatorReason).toBe('condition met')
    })

    it('should not crash when no goal', () => {
      expect(() => updateEvaluatorReason('test')).not.toThrow()
    })
  })

  describe('getGoalDurationMs', () => {
    it('should return 0 when no goal', () => {
      expect(getGoalDurationMs()).toBe(0)
    })

    it('should return positive duration when goal is active', () => {
      setGoal('test')
      expect(getGoalDurationMs()).toBeGreaterThanOrEqual(0)
    })
  })

  describe('execution plan tracking', () => {
    it('should update execution plan', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1', 'Step 2', 'Step 3'])
      const progress = getExecutionProgress()
      expect(progress).toContain('[>] Step 1')
      expect(progress).toContain('[ ] Step 2')
      expect(progress).toContain('[ ] Step 3')
    })

    it('should mark steps as completed', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1', 'Step 2', 'Step 3'])
      markStepCompleted(0)
      const progress = getExecutionProgress()
      expect(progress).toContain('[x] Step 1')
      expect(progress).toContain('[>] Step 2')
    })

    it('should return null when no plan', () => {
      setGoal('test')
      expect(getExecutionProgress()).toBeNull()
    })
  })

  describe('error recovery', () => {
    it('should record step failure', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1', 'Step 2'])
      recordStepFailure(0, 'Connection failed')
      const progress = getExecutionProgress()
      expect(progress).toContain('[!] Step 1')
      expect(getErrorRecoveryHint()).toContain('Connection failed')
    })

    it('should clear step failure', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1'])
      recordStepFailure(0, 'Error')
      clearStepFailure(0)
      expect(getErrorRecoveryHint()).toBeNull()
    })

    it('should suggest alternative after multiple failures', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1'])
      recordStepFailure(0, 'Error 1')
      recordStepFailure(0, 'Error 2')
      recordStepFailure(0, 'Error 3')
      expect(getErrorRecoveryHint()).toContain('Multiple failures')
    })
  })

  describe('self-reflection mechanism', () => {
    it('should initialize reflection with default interval', () => {
      setGoal('test')
      initReflection()
      const goal = getGoal()!
      expect(goal.reflectionInterval).toBe(5)
      expect(goal.lastReflectionTurn).toBe(0)
      expect(goal.reflections).toEqual([])
    })

    it('should initialize reflection with custom interval', () => {
      setGoal('test')
      initReflection(3)
      expect(getGoal()!.reflectionInterval).toBe(3)
    })

    it('should not reflect before interval', () => {
      setGoal('test')
      initReflection(5)
      incrementTurn()
      incrementTurn()
      expect(shouldReflect()).toBe(false)
    })

    it('should reflect after interval', () => {
      setGoal('test')
      initReflection(3)
      incrementTurn()
      incrementTurn()
      incrementTurn()
      expect(shouldReflect()).toBe(true)
    })

    it('should record reflection', () => {
      setGoal('test')
      initReflection(3)
      incrementTurn()
      incrementTurn()
      incrementTurn()
      recordReflection('Current approach is working well')
      const goal = getGoal()!
      expect(goal.reflections).toHaveLength(1)
      expect(goal.reflections![0]).toContain('Current approach is working well')
      expect(goal.lastReflectionTurn).toBe(3)
    })

    it('should record strategy change', () => {
      setGoal('test')
      initReflection()
      incrementTurn()
      recordStrategyChange('Switched to parallel execution')
      const goal = getGoal()!
      expect(goal.strategyChanges).toHaveLength(1)
      expect(goal.strategyChanges![0]).toContain('Switched to parallel execution')
    })

    it('should return null reflection prompt when not needed', () => {
      setGoal('test')
      initReflection(5)
      incrementTurn()
      expect(getReflectionPrompt()).toBeNull()
    })

    it('should return reflection prompt when needed', () => {
      setGoal('test')
      initReflection(2)
      incrementTurn()
      incrementTurn()
      const prompt = getReflectionPrompt()
      expect(prompt).toContain('SELF-REFLECTION REQUIRED')
      expect(prompt).toContain('Evaluate your progress')
    })
  })

  describe('subtask decomposition', () => {
    it('should set subtasks', () => {
      setGoal('test')
      setSubtasks(['Step 1', 'Step 2', 'Step 3'])
      const goal = getGoal()!
      expect(goal.subtasks).toHaveLength(3)
      expect(goal.subtasks![0].description).toBe('Step 1')
      expect(goal.subtasks![0].status).toBe('pending')
    })

    it('should get next subtask', () => {
      setGoal('test')
      setSubtasks(['Step 1', 'Step 2'])
      const next = getNextSubtask()
      expect(next).not.toBeNull()
      expect(next!.description).toBe('Step 1')
    })

    it('should respect dependencies', () => {
      setGoal('test')
      setSubtasks(['Step 1', 'Step 2'])
      updateSubtaskStatus(0, 'completed')
      const next = getNextSubtask()
      expect(next!.description).toBe('Step 2')
    })

    it('should skip blocked subtasks', () => {
      setGoal('test')
      setSubtasks(['Step 1', 'Step 2', 'Step 3'])
      // Step 2 depends on Step 1 (not completed yet)
      const next = getNextSubtask()
      expect(next!.description).toBe('Step 1')
    })

    it('should update subtask status', () => {
      setGoal('test')
      setSubtasks(['Step 1'])
      updateSubtaskStatus(0, 'completed', 'Done')
      const goal = getGoal()!
      expect(goal.subtasks![0].status).toBe('completed')
      expect(goal.subtasks![0].result).toBe('Done')
    })

    it('should get subtask progress', () => {
      setGoal('test')
      setSubtasks(['Step 1', 'Step 2'])
      updateSubtaskStatus(0, 'completed')
      const progress = getSubtaskProgress()
      expect(progress).toContain('[x] Step 1')
      expect(progress).toContain('[ ] Step 2')
    })

    it('should return null when no subtasks', () => {
      setGoal('test')
      expect(getSubtaskProgress()).toBeNull()
      expect(getNextSubtask()).toBeNull()
    })
  })

  describe('context compression', () => {
    it('should record compact event', () => {
      setGoal('test')
      incrementTurn()
      incrementTurn()
      recordCompact('Summarized first 10 messages')
      const goal = getGoal()!
      expect(goal.compactCount).toBe(1)
      expect(goal.lastCompactTurn).toBe(2)
      expect(goal.compactSummaries).toHaveLength(1)
    })

    it('should accumulate compact count', () => {
      setGoal('test')
      incrementTurn()
      recordCompact('First compact')
      incrementTurn()
      recordCompact('Second compact')
      expect(getGoal()!.compactCount).toBe(2)
    })

    it('should return compact status', () => {
      setGoal('test')
      incrementTurn()
      recordCompact('Test compact')
      const status = getCompactStatus()
      expect(status).toContain('1 times')
      expect(status).toContain('turn 1')
    })

    it('should return null when no compacts', () => {
      setGoal('test')
      expect(getCompactStatus()).toBeNull()
    })

    it('should get goal summary', () => {
      setGoal('fix all bugs')
      updateExecutionPlan(['Step 1', 'Step 2'])
      markStepCompleted(0)
      const summary = getGoalSummary()
      expect(summary).toContain('fix all bugs')
      expect(summary).toContain('1/2 steps')
    })

    it('should include error in summary', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1'])
      recordStepFailure(0, 'Connection failed')
      const summary = getGoalSummary()
      expect(summary).toContain('Connection failed')
    })
  })
})
