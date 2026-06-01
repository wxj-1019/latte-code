# /goal Command Documentation

## Overview

The `/goal` command provides autonomous task execution capabilities for the Latte Code CLI. It enables the AI model to work toward a defined objective over multiple turns, with budget control, progress tracking, and intelligent recovery mechanisms.

## File Structure

```
src/commands/goal/
├── index.ts              # Command registration
├── goal.ts               # Command handler (entry point)
├── goalPrompts.ts        # Prompt templates for model guidance
├── goalState.ts          # State management (core logic)
└── __tests__/
    ├── goal.test.ts           # Unit tests for helpers
    ├── goalPrompts.test.ts    # Unit tests for prompts
    ├── goalState.test.ts      # Unit tests for state management
    └── goalIntegration.test.ts # Integration tests
```

## Syntax

```
/goal <objective>     Set a new goal and start autonomous execution
/goal                 Show current goal status
/goal pause           Pause active goal (restores original permission mode)
/goal resume          Resume paused goal (re-enables bypass permissions)
/goal clear           Clear current goal (aliases: stop, off, reset, cancel)
```

## Architecture

### State Management (`goalState.ts`)

The goal system uses session-scoped in-memory state with optional disk persistence.

#### Goal Lifecycle

```
created → active ⇄ paused → active → complete
                    ↓
              budget_limited
```

#### Goal Type

```typescript
type Goal = {
  id: string
  objective: string
  status: 'active' | 'paused' | 'budget_limited' | 'complete'
  maxTurns: number
  turnsUsed: number
  mode: 'objective' | 'condition'
  condition?: string
  tokensSpent: number
  // Execution tracking
  executionPlan?: string[]
  currentStep?: number
  completedSteps?: number[]
  failedSteps?: number[]
  lastError?: string
  retryCount?: number
  // Self-reflection
  reflectionInterval?: number
  reflections?: string[]
  strategyChanges?: string[]
  // Subtask decomposition
  subtasks?: Subtask[]
  // Episodic memory (Reflexion)
  episodicMemory?: EpisodicMemoryEntry[]
  // Adaptive re-planning
  replanCount?: number
  replanTriggers?: string[]
  // Skill library (Voyager)
  skillLibrary?: SkillEntry[]
}
```

### Command Handler (`goal.ts`)

The command handler processes user input and dispatches to subcommands:

- **Typo correction**: Uses Levenshtein distance for fuzzy matching of subcommands (threshold: 1 for inputs ≤3 chars, 2 for longer)
- **Permission management**: Automatically enables `bypassPermissions` mode for autonomous execution and restores the original mode on pause/clear
- **Goal mode detection**: Automatically detects condition mode when objective contains measurable keywords (pass, compile, test, etc.)

### Prompt System (`goalPrompts.ts`)

Prompts are injected at the end of each turn to guide the model:

#### Initial Prompt (`buildGoalInitialPrompt`)
- Defines a 7-phase workflow: Research → Plan → Execute → Learning → Verify → Adaptation → Completion
- Teaches the model about episodic memory recording and skill library usage

#### Continuation Prompt (`buildGoalContinuationPrompt`)
- Injects current progress, execution plan status, and subtask progress
- Includes episodic memory lessons from past failures
- Triggers adaptive re-planning when progress is poor
- Shows relevant skills from the skill library
- Highlights parallelizable tasks

#### Evaluator Prompt (`buildGoalEvaluatorPrompt`)
- Structured verification checklist for condition-mode goals
- Requires explicit yes/no completion assessment

#### Budget Limit Prompt (`buildGoalBudgetLimitPrompt`)
- Summarizes accomplishments when max turns reached
- Lists remaining items and blockers

#### Suppression Prompt (`buildGoalSuppressionPrompt`)
- Auto-completes goal when model stops making tool calls

## Core Features

### 1. Budget Control

Each goal has a configurable turn budget (default: 50, max: 200).

**Environment variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_MAX_TURNS` | 50 | Default max turns per goal |
| `GOAL_MAX_TURNS_LIMIT` | 200 | Maximum allowed turns |

**Resource warnings** are injected at configurable thresholds:
- 60%: `[NOTICE: >60% turns used - focus on high-impact items]`
- 80%: `[WARNING: >80% turns used - prioritize critical steps]`

### 2. Continuation Suppression

When the model stops making tool calls, the system auto-completes after a configurable number of idle turns.

| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_MAX_ZERO_TOOL_CALLS` | 5 | Turns without tools before suppression |

### 3. Self-Reflection Mechanism

Periodically prompts the model to evaluate its own progress and strategy.

| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_REFLECTION_INTERVAL` | 5 | Turns between reflections |
| `GOAL_REFLECTION_COOLDOWN_MS` | 2000 | Minimum ms between reflections |

**Reflection prompt evaluates:**
- Progress vs. plan completion
- Strategy effectiveness
- Blockers and alternative approaches

### 4. Episodic Memory (Reflexion Pattern)

Records failures and lessons learned to avoid repeating mistakes.

```typescript
interface EpisodicMemoryEntry {
  turn: number
  action: string        // What was attempted
  outcome: 'success' | 'failure' | 'partial'
  error?: string        // Error message if failed
  reflection: string    // Why it failed/succeeded
  lesson: string        // Reusable insight
  timestamp: number
}
```

**Key functions:**
- `recordEpisode()` — Record an action outcome
- `getRelevantLessons()` — Get failure lessons for prompt injection
- `getEpisodicSummary()` — Get status summary

**Limits:** Max 20 episodes stored (oldest evicted), max 3 lessons injected per prompt.

### 5. Adaptive Re-Planning

Automatically triggers when the current plan is not working.

**Triggers:**
- >60% turns used but <30% steps completed
- 2+ steps have failed
- Same step retrying 3+ times

**Cooldown:** 5 turns between re-planning events.

### 6. Skill Library (Voyager Pattern)

Accumulates reusable patterns and solutions during goal execution.

```typescript
interface SkillEntry {
  id: string
  name: string
  description: string
  code?: string
  context: string       // Usage scenario
  successCount: number
  failureCount: number
  lastUsedTurn: number
  tags: string[]
}
```

**Key functions:**
- `recordSkill()` — Record a reusable pattern (deduplicates by name)
- `getRelevantSkills()` — Find skills matching current context
- `getSkillLibrarySummary()` — Get status summary

**Limits:** Max 30 skills, max 3 injected per prompt, sorted by success rate.

### 7. Subtask Decomposition

Supports two modes:

#### Sequential (`setSubtasks`)
Creates a linear dependency chain: task N depends on task N-1.

#### DAG-based (`setSubtasksFromGraph`)
Supports arbitrary dependency graphs with priority and parallelism flags.

```typescript
type Subtask = {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependencies?: number[]
  priority?: number       // 1=high, 2=medium, 3=low
  canParallel?: boolean
  startedAt?: number
  completedAt?: number
}
```

**Key functions:**
- `getNextSubtask()` — Get highest-priority ready task
- `getReadySubtasks()` — Get all tasks with dependencies met
- `getParallelHint()` — Get parallelizable task suggestions
- `updateSubtaskStatus()` — Update status with automatic timestamping

### 8. Enterprise Features

#### Audit Logging
Records all goal lifecycle events with timestamps and metadata.

**Actions:** `created`, `paused`, `resumed`, `completed`, `failed`, `cleared`, `budget_exhausted`, `strategy_changed`

**Limits:** Max 100 entries in memory, 50 persisted to disk.

#### Metrics Collection
Tracks aggregate statistics across all goals:
- Total goals created/completed/failed
- Total turns used
- Average turns per goal
- Success rate

#### Progress Persistence
Persists goal state to disk at `~/.claude/goal-persistence/goal_persistence.json`:
- On every state change (via sessionStorage)
- Every 5 turns (direct disk write)
- Includes validation on load to prevent corrupted data

#### Webhook Support
Fires HTTP POST to configured URL on audit events.

```typescript
setWebhookConfig({
  url: 'https://example.com/webhook',
  events: ['completed', 'failed'],
  secret: 'optional-secret'
})
```

- 5-second timeout on fetch
- Fire-and-forget (does not block goal execution)
- Secret sent via `X-Webhook-Secret` header

## Configuration

### Environment Variables Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `GOAL_MAX_TURNS` | 50 | Default max turns per goal |
| `GOAL_MAX_TURNS_LIMIT` | 200 | Maximum allowed turns |
| `GOAL_MAX_ZERO_TOOL_CALLS` | 5 | Idle turns before suppression |
| `GOAL_REFLECTION_INTERVAL` | 5 | Turns between reflections |
| `GOAL_REFLECTION_COOLDOWN_MS` | 2000 | Reflection cooldown (ms) |
| `GOAL_RESOURCE_WARNING_60` | 60 | First warning threshold (%) |
| `GOAL_RESOURCE_WARNING_80` | 80 | Second warning threshold (%) |
| `GOAL_DEBUG` | - | Enable debug logging to stderr |
| `DEBUG` | - | Enable debug logging to stderr |

### Goal Modes

#### Objective Mode (default)
The model works toward completing a described objective. Completion is self-reported via `[GOAL_COMPLETED]` marker.

#### Condition Mode
Activated when the objective contains measurable keywords:
- Starts with "when" or "if"
- Contains: pass, exit, no errors, no failures, tests pass, compile, build, git status, git diff

In condition mode, the evaluator prompt asks the model to explicitly verify the condition is met.

## Integration Points

### Query Loop (`query.ts`)
- Detects `[GOAL_COMPLETED]` in assistant text (two check points: after tools and at end turn)
- Injects continuation prompts when goal is active
- Handles budget exhaustion and suppression
- Manages permission mode switching

### Status Line (`StatusLine.tsx`)
- Displays goal status in the terminal status line
- Shows turn progress and duration

### Session Storage (`sessionStorage.ts`)
- Persists goal state in session metadata
- Supports resume across session restarts

## Testing

Run tests with:
```bash
bun test src/commands/goal/__tests__/
```

**Test coverage:**
- `goal.test.ts`: Levenshtein distance, subcommand matching, typo detection
- `goalPrompts.test.ts`: Prompt generation, condition mode, urgency handling
- `goalState.test.ts`: State management, audit logging, metrics, persistence, episodic memory, skill library, re-planning
- `goalIntegration.test.ts`: End-to-end goal lifecycle

## Known Limitations

1. **Completion detection**: Relies on `[GOAL_COMPLETED]` text marker in model output; may not trigger if the marker is embedded in tool call arguments
2. **No true parallel execution**: Subtask parallelism is advisory only; the model must execute tasks in parallel using multiple tool calls
3. **Session-scoped**: Episodic memory and skill library are lost between sessions unless persisted via disk state
4. **Single goal**: Only one active goal at a time; setting a new goal overwrites the previous one
