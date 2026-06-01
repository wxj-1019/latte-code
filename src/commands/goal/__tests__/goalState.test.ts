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
  getAuditLog,
  clearAuditLog,
  getGoalMetrics,
  resetMetrics,
  getWebhookConfig,
  setWebhookConfig,
  resetReflectionCooldown,
  recordSkillOutcome,
  isSkillDeprecated,
  getDeprecatedSkills,
  setGoalVerification,
  recordVerificationResult,
  isVerificationPassed,
  getVerificationStatus,
  getGoalVerification,
  setBudgetConfig,
  checkBudgetWarning,
  getBudgetStatus,
  getBudgetConfig,
} from '../goalState.js'

describe('goalState', () => {
  beforeEach(() => {
    clearGoal()
    clearAuditLog()
    resetMetrics()
    resetReflectionCooldown()
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

  describe('enterprise features: audit logging', () => {
    it('should record audit entry when goal is created', () => {
      setGoal('test objective')
      const auditLog = getAuditLog()
      expect(auditLog.length).toBeGreaterThan(0)
      expect(auditLog[0].action).toBe('created')
      expect(auditLog[0].objective).toBe('test objective')
    })

    it('should record audit entry when goal is paused', () => {
      setGoal('test')
      pauseGoal()
      const auditLog = getAuditLog()
      const pauseEntry = auditLog.find(e => e.action === 'paused')
      expect(pauseEntry).toBeDefined()
    })

    it('should record audit entry when goal is resumed', () => {
      setGoal('test')
      pauseGoal()
      resumeGoal()
      const auditLog = getAuditLog()
      const resumeEntry = auditLog.find(e => e.action === 'resumed')
      expect(resumeEntry).toBeDefined()
    })

    it('should record audit entry when goal is completed', () => {
      setGoal('test')
      markGoalComplete()
      const auditLog = getAuditLog()
      const completeEntry = auditLog.find(e => e.action === 'completed')
      expect(completeEntry).toBeDefined()
      expect(completeEntry.metadata).toHaveProperty('turnsUsed')
      expect(completeEntry.metadata).toHaveProperty('tokensSpent')
    })

    it('should record audit entry when goal is budget limited', () => {
      setGoal('test')
      markGoalBudgetLimited()
      const auditLog = getAuditLog()
      const budgetEntry = auditLog.find(e => e.action === 'budget_exhausted')
      expect(budgetEntry).toBeDefined()
    })

    it('should record audit entry when strategy changes', () => {
      setGoal('test')
      initReflection(1)
      incrementTurn()
      recordStrategyChange('New strategy')
      const auditLog = getAuditLog()
      const strategyEntry = auditLog.find(e => e.action === 'strategy_changed')
      expect(strategyEntry).toBeDefined()
      expect(strategyEntry.metadata).toHaveProperty('change', 'New strategy')
    })

    it('should record audit entry on step failure', () => {
      setGoal('test')
      updateExecutionPlan(['Step 1'])
      recordStepFailure(0, 'Error occurred')
      const auditLog = getAuditLog()
      const failureEntry = auditLog.find(e => e.action === 'failed' && e.metadata?.reason === 'step_failure')
      expect(failureEntry).toBeDefined()
      expect(failureEntry.metadata).toHaveProperty('error', 'Error occurred')
    })

    it('should record audit entry when goal is cleared', () => {
      setGoal('test')
      clearGoal()
      const auditLog = getAuditLog()
      const clearEntry = auditLog.find(e => e.action === 'cleared' && e.metadata?.reason === 'manually_cleared')
      expect(clearEntry).toBeDefined()
    })
  })

  describe('enterprise features: metrics collection', () => {
    it('should track total goals created', () => {
      setGoal('test 1')
      setGoal('test 2')
      const metrics = getGoalMetrics()
      expect(metrics.totalGoalsCreated).toBeGreaterThanOrEqual(2)
    })

    it('should track total goals completed', () => {
      setGoal('test')
      markGoalComplete()
      const metrics = getGoalMetrics()
      expect(metrics.totalGoalsCompleted).toBeGreaterThanOrEqual(1)
    })

    it('should track total goals failed', () => {
      setGoal('test')
      markGoalBudgetLimited()
      const metrics = getGoalMetrics()
      expect(metrics.totalGoalsFailed).toBeGreaterThanOrEqual(1)
    })

    it('should calculate success rate', () => {
      const metrics = getGoalMetrics()
      expect(metrics.successRate).toBeGreaterThanOrEqual(0)
      expect(metrics.successRate).toBeLessThanOrEqual(100)
    })

    it('should calculate average turns per goal', () => {
      const metrics = getGoalMetrics()
      expect(metrics.averageTurnsPerGoal).toBeGreaterThanOrEqual(0)
    })
  })

  describe('enterprise features: webhook configuration', () => {
    it('should set and get webhook config', () => {
      const config = {
        url: 'https://example.com/webhook',
        events: ['created', 'completed' as const],
        secret: 'test-secret',
      }
      setWebhookConfig(config)
      expect(getWebhookConfig()).toEqual(config)
    })

    it('should clear webhook config', () => {
      setWebhookConfig({
        url: 'https://example.com/webhook',
        events: ['created'],
      })
      setWebhookConfig(null)
      expect(getWebhookConfig()).toBeNull()
    })

    it('should return null when no webhook configured', () => {
      setWebhookConfig(null)
      expect(getWebhookConfig()).toBeNull()
    })
  })

  describe('skill demotion (PANDO pattern)', () => {
    it('should record skill outcome', () => {
      setGoal('test')
      recordSkillOutcome('test-skill', true)
      // No crash even if skill doesn't exist yet
    })

    it('should mark skill as deprecated after consecutive failures', () => {
      setGoal('test')
      // First, create a skill via recordSkillOutcome by adding it manually
      const goal = getGoal()!
      goal.skillLibrary = [{
        id: 'skill_1',
        name: 'bad-skill',
        description: 'A failing skill',
        context: 'test',
        successCount: 0,
        failureCount: 0,
        lastUsedTurn: 0,
        tags: ['test'],
        successWindow: [],
        deprecated: false,
      }]

      // 3 consecutive failures should trigger demotion
      recordSkillOutcome('bad-skill', false)
      recordSkillOutcome('bad-skill', false)
      recordSkillOutcome('bad-skill', false)

      expect(isSkillDeprecated('bad-skill')).toBe(true)
      const deprecated = getDeprecatedSkills()
      expect(deprecated).toHaveLength(1)
      expect(deprecated[0].name).toBe('bad-skill')
      expect(deprecated[0].reason).toContain('Consecutive')
    })

    it('should not demote skill with mixed outcomes', () => {
      setGoal('test')
      const goal = getGoal()!
      goal.skillLibrary = [{
        id: 'skill_2',
        name: 'mixed-skill',
        description: 'Mixed results',
        context: 'test',
        successCount: 0,
        failureCount: 0,
        lastUsedTurn: 0,
        tags: ['test'],
        successWindow: [],
        deprecated: false,
      }]

      recordSkillOutcome('mixed-skill', true)
      recordSkillOutcome('mixed-skill', false)
      recordSkillOutcome('mixed-skill', true)

      expect(isSkillDeprecated('mixed-skill')).toBe(false)
    })

    it('should return empty deprecated list when none', () => {
      setGoal('test')
      expect(getDeprecatedSkills()).toEqual([])
    })
  })

  describe('auto-verification', () => {
    it('should set and get verification config', () => {
      setGoal('test')
      setGoalVerification({
        commands: ['npm test', 'tsc --noEmit'],
        maxRetries: 2,
        timeoutMs: 30000,
      })
      const config = getGoalVerification()
      expect(config).not.toBeNull()
      expect(config!.commands).toEqual(['npm test', 'tsc --noEmit'])
      expect(config!.maxRetries).toBe(2)
    })

    it('should record verification results', () => {
      setGoal('test')
      setGoalVerification({
        commands: ['npm test'],
        maxRetries: 1,
        timeoutMs: 10000,
      })

      recordVerificationResult({
        passed: true,
        command: 'npm test',
        exitCode: 0,
        stdout: 'All tests passed',
        stderr: '',
        timestamp: Date.now(),
      })

      expect(isVerificationPassed()).toBe(true)
    })

    it('should fail verification when exit code is non-zero', () => {
      setGoal('test')
      setGoalVerification({
        commands: ['npm test'],
        maxRetries: 1,
        timeoutMs: 10000,
      })

      recordVerificationResult({
        passed: false,
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'Test failed',
        timestamp: Date.now(),
      })

      expect(isVerificationPassed()).toBe(false)
    })

    it('should pass when no verification configured', () => {
      setGoal('test')
      expect(isVerificationPassed()).toBe(true)
    })

    it('should return verification status', () => {
      setGoal('test')
      expect(getVerificationStatus()).toBeNull()

      setGoalVerification({
        commands: ['npm test'],
        maxRetries: 1,
        timeoutMs: 10000,
      })
      expect(getVerificationStatus()).toContain('configured but not yet run')

      recordVerificationResult({
        passed: true,
        command: 'npm test',
        exitCode: 0,
        stdout: '',
        stderr: '',
        timestamp: Date.now(),
      })
      expect(getVerificationStatus()).toContain('all 1 commands passed')
    })
  })

  describe('token budget (cost guardrails)', () => {
    it('should set and get budget config', () => {
      setGoal('test')
      setBudgetConfig({
        maxTokensTotal: 100000,
        maxCostUSD: 5.0,
        warningThresholds: { tokens: [60, 80], cost: [50, 80] },
      })
      const config = getBudgetConfig()
      expect(config).not.toBeNull()
      expect(config!.maxTokensTotal).toBe(100000)
      expect(config!.maxCostUSD).toBe(5.0)
    })

    it('should return empty warnings when under threshold', () => {
      setGoal('test')
      setBudgetConfig({
        maxTokensTotal: 100000,
        warningThresholds: { tokens: [60, 80], cost: [] },
      })
      addTokensSpent(1000) // 1% usage
      expect(checkBudgetWarning()).toEqual([])
    })

    it('should return warning when threshold crossed', () => {
      setGoal('test')
      setBudgetConfig({
        maxTokensTotal: 10000,
        warningThresholds: { tokens: [60, 80], cost: [] },
      })
      addTokensSpent(7000) // 70% usage
      const warnings = checkBudgetWarning()
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('70%')
    })

    it('should return budget status', () => {
      setGoal('test')
      setBudgetConfig({
        maxTokensTotal: 100000,
        maxCostUSD: 5.0,
        warningThresholds: { tokens: [], cost: [] },
      })
      addTokensSpent(5000)
      const status = getBudgetStatus()
      expect(status).toContain('5.0k')
      expect(status).toContain('100.0k')
      expect(status).toContain('Max: $5')
    })

    it('should report highest crossed threshold', () => {
      setGoal('test')
      setBudgetConfig({
        maxTokensTotal: 10000,
        warningThresholds: { tokens: [60, 80], cost: [] },
      })
      addTokensSpent(8500) // 85% usage - crosses both 60 and 80
      const warnings = checkBudgetWarning()
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('85%')
    })

    it('should return null when no budget configured', () => {
      setGoal('test')
      expect(getBudgetStatus()).toBeNull()
      expect(checkBudgetWarning()).toEqual([])
    })
  })

  describe('deserializeGoal with new fields', () => {
    it('should restore verification config', () => {
      setGoal('test')
      setGoalVerification({ commands: ['npm test'], maxRetries: 1, timeoutMs: 10000 })
      const serialized = serializeGoal()!
      clearGoal()
      expect(getGoal()).toBeNull()

      deserializeGoal(serialized)
      const verification = getGoalVerification()
      expect(verification).not.toBeNull()
      expect(verification!.commands).toEqual(['npm test'])
    })

    it('should restore budget config', () => {
      setGoal('test')
      setBudgetConfig({ maxTokensTotal: 50000, warningThresholds: { tokens: [80], cost: [] } })
      const serialized = serializeGoal()!
      clearGoal()

      deserializeGoal(serialized)
      const budget = getBudgetConfig()
      expect(budget).not.toBeNull()
      expect(budget!.maxTokensTotal).toBe(50000)
    })
  })

  describe('formatGoalStatus with new features', () => {
    it('should include verification status in format', () => {
      setGoal('test', 10)
      setGoalVerification({ commands: ['npm test'], maxRetries: 1, timeoutMs: 10000 })
      const status = formatGoalStatus()
      expect(status).toContain('Verification')
    })

    it('should include budget status in format', () => {
      setGoal('test', 10)
      setBudgetConfig({ maxTokensTotal: 100000, warningThresholds: { tokens: [], cost: [] } })
      addTokensSpent(5000)
      const status = formatGoalStatus()
      expect(status).toContain('Tokens')
    })
  })
})
