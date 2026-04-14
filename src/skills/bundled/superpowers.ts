import { registerBundledSkill } from '../bundledSkills.js'

/**
 * Superpowers - 完整的软件开发工作流技能框架
 * 
 * 来源: https://github.com/obra/superpowers
 * 作者: Jesse Vincent (Prime Radiant)
 * 许可证: MIT
 * 
 * 核心理念:
 * - 测试驱动开发 (TDD) - 先写测试，始终如此
 * - 系统化优于临时性 - 流程优于猜测
 * - 降低复杂度 - 简单性是首要目标
 * - 证据胜于断言 - 验证后才宣布成功
 */

const BRAINSTORMING_SKILL = `---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **Explore project context** — check files, docs, recent commits
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches** — with trade-offs and your recommendation
4. **Present design** — in sections scaled to their complexity, get user approval after each section
5. **Write design doc** — save to \`docs/superpowers/specs/YYYY-MM-DD--design.md\`
6. **User reviews written spec** — ask user to review the spec file before proceeding
7. **Transition to implementation** — invoke writing-plans skill to create implementation plan

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems, flag this immediately
- If the project is too large for a single spec, help the user decompose into sub-projects
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose
- For each unit: what does it do, how do you use it, what does it depend on?
- Can someone understand what a unit does without reading its internals?
- Smaller, well-bounded units are easier to work with

**Working in existing codebases:**

- Explore the current structure before proposing changes
- Follow existing patterns
- Include targeted improvements as part of the design
- Don't propose unrelated refactoring

## After the Design

**Documentation:**

- Write the validated design to \`docs/superpowers/specs/YYYY-MM-DD--design.md\`
- Commit the design document to git

**User Review Gate:**
After writing, ask the user to review:

> "Spec written and committed to \`<path>\`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them. Only proceed once the user approves.

**Implementation:**

- Invoke the writing-plans skill to create a detailed implementation plan
- Do NOT invoke any other skill. writing-plans is the next step.

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design, get approval before moving on
- **Be flexible** - Go back and clarify when something doesn't make sense
`

const TDD_SKILL = `---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use

**Always:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (ask your human partner):**
- Throwaway prototypes
- Generated code
- Configuration files

## The Iron Law

\`\`\`
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
\`\`\`

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

## Red-Green-Refactor

### RED - Write Failing Test

Write one minimal test showing what should happen.

**Requirements:**
- One behavior
- Clear name
- Real code (no mocks unless unavoidable)

### Verify RED - Watch It Fail

**MANDATORY. Never skip.**

\`\`\`bash
npm test path/to/test.test.ts
\`\`\`

Confirm:
- Test fails (not errors)
- Failure message is expected
- Fails because feature missing (not typos)

**Test passes?** You're testing existing behavior. Fix test.

**Test errors?** Fix error, re-run until it fails correctly.

### GREEN - Minimal Code

Write simplest code to pass the test.

Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN - Watch It Pass

**MANDATORY.**

\`\`\`bash
npm test path/to/test.test.ts
\`\`\`

Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix code, not test.

**Other tests fail?** Fix now.

### REFACTOR - Clean Up

After green only:
- Remove duplication
- Improve names
- Extract helpers

Keep tests green. Don't add behavior.

### Repeat

Next failing test for next feature.

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing | \`test('validates email and domain')\` |
| **Clear** | Name describes behavior | \`test('test1')\` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "TDD is dogmatic" | TDD IS pragmatic: finds bugs before commit |

## Red Flags - STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

## Final Rule

\`\`\`
Production code → test exists and failed first
Otherwise → not TDD
\`\`\`

No exceptions without your human partner's permission.
`

const WRITING_PLANS_SKILL = `---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** \`docs/superpowers/plans/YYYY-MM-DD-.md\`

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

\`\`\`markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
\`\`\`

## Task Structure

\`\`\`markdown
### Task N: [Component Name]

**Files:**
- Create: \`exact/path/to/file.py\`
- Modify: \`exact/path/to/existing.py:123-145\`
- Test: \`tests/exact/path/to/test.py\`

- [ ] **Step 1: Write the failing test**

\`\`\`python
def test_specific_behavior():
    result = function(input)
    assert result == expected
\`\`\`

- [ ] **Step 2: Run test to verify it fails**

Run: \`pytest tests/path/test.py::test_name -v\`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

\`\`\`python
def function(input):
    return expected
\`\`\`

- [ ] **Step 4: Run test to verify it passes**

Run: \`pytest tests/path/test.py::test_name -v\`
Expected: PASS

- [ ] **Step 5: Commit**

\`\`\`bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
\`\`\`
\`\`\`

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code)
- Steps that describe what to do without showing how

## Self-Review

After writing the complete plan:

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it?

**2. Placeholder scan:** Search your plan for red flags.

**3. Type consistency:** Do types, signatures, and names match across tasks?

If you find issues, fix them inline.

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to \`docs/superpowers/plans/<name>.md\`. Two execution options:**

**1. Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks

**2. Inline Execution** - Execute tasks in this session with checkpoints

**Which approach?"**
`

const SYSTEMATIC_DEBUGGING_SKILL = `---
name: systematic-debugging
description: Use when diagnosing bugs, failures, or unexpected behavior
---

# Systematic Debugging

## Overview

Follow a disciplined 4-phase process to find and fix root causes. Don't guess. Verify.

## The 4 Phases

### Phase 1: Reproduction

**Goal:** Make the bug happen reliably

- [ ] Create minimal reproduction case
- [ ] Document exact steps to trigger
- [ ] Confirm it fails consistently
- [ ] If intermittent, identify triggering conditions

**Can't reproduce?**
- Check environment differences
- Review recent changes
- Add logging to capture state

### Phase 2: Isolation

**Goal:** Narrow down where the bug lives

- [ ] Binary search: Comment out half the code, test
- [ ] Check inputs at each layer
- [ ] Verify assumptions with assertions
- [ ] Use debugger or logging to trace execution

**Isolation techniques:**
- Divide and conquer
- Check boundaries (first/last items, empty collections)
- Verify invariants at key points

### Phase 3: Hypothesis

**Goal:** Form and test theories about root cause

- [ ] List possible causes
- [ ] Prioritize by likelihood
- [ ] Design test to confirm/disprove each
- [ ] Run tests, record results

**Good hypothesis:**
- Specific: "The null check is missing on line 42"
- Testable: Can verify with a specific test
- Predicts behavior: Explains both the failure and success cases

### Phase 4: Fix and Verify

**Goal:** Fix the root cause, not the symptom

- [ ] Write failing test that reproduces the bug
- [ ] Implement minimal fix
- [ ] Verify test passes
- [ ] Verify no regressions (run full test suite)
- [ ] Check for similar issues elsewhere

**Before marking complete:**
- [ ] Bug is fixed in reproduction case
- [ ] Root cause is understood (can explain why it failed)
- [ ] Fix is minimal and correct
- [ ] Tests prevent regression
- [ ] No new issues introduced

## Anti-Patterns

**Don't:**
- Change code randomly hoping it fixes the issue
- Fix symptoms without understanding root cause
- Skip writing a regression test
- Assume the fix works without verification

## Integration with TDD

When bug found:
1. Write failing test reproducing bug
2. Follow TDD cycle (RED-GREEN-REFACTOR)
3. Test now proves fix and prevents regression

Never fix bugs without a test.
`

const SUBAGENT_DRIVEN_DEV_SKILL = `---
name: subagent-driven-development
description: Use when executing implementation plans with multiple tasks
---

# Subagent-Driven Development

## Overview

Execute implementation plans by dispatching fresh subagents for each task. Fast iteration with quality gates.

**When to use:** Multi-task implementation plans created by writing-plans skill

**Process:** One subagent per task → Two-stage review → Continue or fix

## Workflow

\`\`\`
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Task N    │───▶│  Subagent   │───▶│   Review    │
│  (from plan) │    │  (execute)  │    │ (2-stage)   │
└─────────────┘    └─────────────┘    └──────┬──────┘
                                             │
                    ┌─────────────┐         │
                    │   Task N+1  │◀────────┘
                    │   (next)    │   Pass
                    └─────────────┘
                          ▲
                          │ Fail
                    ┌─────┴─────┐
                    │   Fix &   │
                    │  Redo N   │
                    └───────────┘
\`\`\`

## Task Dispatch

For each task in the plan:

1. **Prepare context:**
   - Task description from plan
   - Current codebase state
   - Any relevant previous task outputs

2. **Dispatch subagent:**
   - Clear, specific instructions
   - Include complete code examples from plan
   - Specify verification steps

3. **Two-stage review:**
   - **Stage 1:** Spec compliance - Does it match the plan?
   - **Stage 2:** Code quality - Is the implementation good?

## Review Checklist

**Stage 1 - Spec Compliance:**
- [ ] Implements exactly what the task specified
- [ ] No scope creep or missing functionality
- [ ] File paths and structure match plan
- [ ] Tests included as specified

**Stage 2 - Code Quality:**
- [ ] Code is clear and maintainable
- [ ] Follows project conventions
- [ ] Proper error handling
- [ ] No obvious bugs or issues

**Decision:**
- **Pass:** Move to next task
- **Fail (fixable):** Send back with specific feedback
- **Fail (fundamental):** Revisit plan, may need adjustment

## Communication Pattern

**To subagent:**
\`\`\`
You are implementing Task N of [Feature] implementation plan.

**Your task:** [Exact task description from plan]

**Complete code to implement:**
[Code blocks from plan]

**Verification:**
[How to verify this task is complete]

**Context you need:**
[Relevant files, previous outputs]

Execute this task following TDD principles. Return:
1. What you implemented
2. Test results
3. Any issues encountered
\`\`\`

## Error Handling

**Subagent fails:**
- Analyze failure reason
- If unclear instructions: Clarify and retry
- If underestimated complexity: Split task, update plan
- If discovered dependency: Reorder tasks, update plan

**Task reveals plan flaw:**
- Stop execution
- Update plan document
- Get user approval for changes
- Resume from affected task

## Completion

When all tasks complete:
1. Final verification run
2. Full test suite check
3. Offer to create PR/merge

## Principles

- **Fresh context per task:** Each subagent starts clean
- **Explicit over implicit:** All requirements in task description
- **Verify at boundaries:** Check between every task
- **Adapt the plan:** Update plan when reality differs
`

const GIT_WORKTREES_SKILL = `---
name: using-git-worktrees
description: Use when starting new feature work to create isolated workspace
---

# Using Git Worktrees

## Overview

Create isolated development workspaces for features using git worktrees. Keep main branch clean, enable parallel work.

## When to Use

- Starting new feature implementation
- Working on multiple features in parallel
- Long-running experiments
- Code reviews that need testing

## Workflow

### 1. Create Worktree

\`\`\`bash
# From main branch, up to date
git checkout main
git pull

# Create worktree for new feature
git worktree add -b feature/my-feature ../my-feature-worktree

# Enter worktree
cd ../my-feature-worktree
\`\`\`

### 2. Setup Environment

\`\`\`bash
# Install dependencies
npm install  # or yarn, pnpm, etc.

# Verify clean baseline
npm test
\`\`\`

**Tests must pass before starting work.**

### 3. Work in Isolation

- Implement feature in worktree
- Regular commits
- No interference with main work

### 4. Finish Worktree

When work complete (use finishing-a-development-branch skill):

\`\`\`bash
# Option A: Merge to main
git checkout main
git merge feature/my-feature
git worktree remove ../my-feature-worktree

# Option B: Create PR
git push origin feature/my-feature
# Create PR via GitHub/GitLab/etc
git worktree remove ../my-feature-worktree

# Option C: Discard
git worktree remove -f ../my-feature-worktree
git branch -D feature/my-feature
\`\`\`

## Benefits

- **Clean context:** No uncommitted changes from other work
- **Parallel development:** Multiple features simultaneously
- **Easy switching:** No stash/pop dance
- **Safe experiments:** Easy to discard if needed

## Best Practices

- Name worktree directory after branch
- One worktree per feature
- Clean up merged/abandoned worktrees
- Keep main worktree for quick fixes
`

const FINISHING_BRANCH_SKILL = `---
name: finishing-a-development-branch
description: Use when completing work in a worktree to decide merge/PR/discard
---

# Finishing a Development Branch

## Overview

Clean completion workflow for feature branches. Verify, decide, execute.

## Checklist

### 1. Final Verification

\`\`\`bash
# All tests pass
npm test

# Lint clean
npm run lint

# Type check (if applicable)
npm run typecheck
\`\`\`

### 2. Review Changes

\`\`\`bash
# See what changed
git diff main

# Review commit history
git log main..HEAD --oneline
\`\`\`

### 3. Decision

Present options to user:

**A. Merge to main (if simple/safe):**
\`\`\`bash
git checkout main
git merge --no-ff feature/branch-name
\`\`\`

**B. Create Pull Request (if review needed):**
\`\`\`bash
git push origin feature/branch-name
# Guide user through PR creation
\`\`\`

**C. Keep as-is (if not ready):**
- Leave worktree intact
- Document remaining work

**D. Discard (if abandoned):**
\`\`\`bash
git worktree remove -f ../worktree-name
git branch -D feature/branch-name
\`\`\`

### 4. Cleanup

After merge/PR/discard:
\`\`\`bash
# Remove worktree
git worktree remove ../worktree-name

# Verify main branch
cd /path/to/main/repo
git checkout main
npm test
\`\`\`

## Questions to Ask User

1. "All tests pass. Want me to merge to main, create a PR, or keep working?"
2. "Should I clean up the worktree now or keep it for follow-up work?"

## Post-Merge

- Verify main branch works
- Delete remote branch if merged
- Update any related issues/tickets
`

const CODE_REVIEW_SKILL = `---
name: requesting-code-review
description: Use before completing work to self-review against requirements
---

# Requesting Code Review

## Overview

Self-review checklist before declaring work complete. Catch issues before human review.

## Review Checklist

### Requirements

- [ ] Implements all specified requirements
- [ ] No scope creep (YAGNI check)
- [ ] Handles edge cases specified
- [ ] Error handling appropriate

### Code Quality

- [ ] Clear, readable code
- [ ] Good naming (functions, variables, files)
- [ ] No obvious duplication (DRY)
- [ ] Follows project conventions
- [ ] Properly typed (if using TypeScript/etc)

### Testing

- [ ] All tests pass
- [ ] New functionality has tests
- [ ] Tests are meaningful (not just coverage)
- [ ] Edge cases tested
- [ ] Watched tests fail before implementation

### Documentation

- [ ] Complex logic explained
- [ ] Public APIs documented
- [ ] README updated if needed
- [ ] Comments explain why, not what

### Verification

- [ ] Manual testing confirms it works
- [ ] No console errors/warnings
- [ ] No leftover debug code
- [ ] Clean git history (logical commits)

## Severity Levels

**Critical:** Must fix before completing
- Missing functionality
- Broken tests
- Security issues

**Warning:** Should fix, can discuss
- Code style issues
- Minor refactoring opportunities

**Info:** FYI, optional
- Alternative approaches
- Future improvements

## Process

1. Run through checklist systematically
2. List any issues found with severity
3. Fix critical issues
4. Present warnings/info to user
5. Get confirmation before proceeding
`

const USING_SUPERPOWERS_GUIDE = `# Using Superpowers

## Overview

Superpowers is a complete software development workflow system. Skills trigger automatically when relevant - you don't invoke them manually.

## Philosophy

- **Test-Driven Development** - Write tests first, always
- **Systematic over ad-hoc** - Process over guessing
- **Complexity reduction** - Simplicity as primary goal
- **Evidence over claims** - Verify before declaring success

## Standard Workflow

\`\`\`
┌─────────────────┐
│  Brainstorming  │ ◀── Every project starts here
│  (设计细化)      │     Ask questions, explore alternatives
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Git Worktrees   │ ◀── Create isolated workspace
│ (隔离工作区)     │     Clean environment, clean tests
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Writing Plans   │ ◀── Break into small tasks (2-5 min each)
│ (编写计划)       │     Exact files, complete code
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Subagent/Dev  │ ◀── Execute plan task by task
│   (子代理开发)   │     TDD, review between tasks
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Code Review     │ ◀── Self-review before completing
│ (代码审查)       │     Requirements, quality, tests
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Finish Branch   │ ◀── Merge, PR, or discard
│ (完成分支)       │     Clean up worktree
└─────────────────┘
\`\`\`

## Available Skills

### Testing
- **test-driven-development** - RED-GREEN-REFACTOR cycle

### Debugging
- **systematic-debugging** - 4-phase root cause analysis

### Collaboration
- **brainstorming** - Socratic design refinement
- **writing-plans** - Detailed implementation plans
- **subagent-driven-development** - Task-by-task execution
- **using-git-worktrees** - Parallel development branches
- **finishing-a-development-branch** - Merge/PR decision workflow
- **requesting-code-review** - Pre-review checklist

## Key Principles

1. **Skills trigger automatically** - Based on context, not commands
2. **Mandatory workflows** - Not suggestions, must follow
3. **Small tasks** - 2-5 minutes each
4. **Complete code** - No placeholders in plans
5. **TDD always** - Test first, watch fail, implement, watch pass
6. **Verify everything** - Don't assume, prove it works

## Getting Started

Start any new work with: "Let's build [feature]"

The brainstorming skill will activate automatically and guide you through the design process.

---
*Source: https://github.com/obra/superpowers*
*Author: Jesse Vincent (Prime Radiant)*
*License: MIT*
`

export function registerSuperpowersSkill(): void {
  registerBundledSkill({
    name: 'superpowers',
    description:
      'Complete software development workflow framework with TDD, systematic debugging, and structured planning. Skills trigger automatically based on context.',
    descriptionZh:
      '完整的软件开发工作流框架，包含测试驱动开发、系统化调试和结构化规划。技能根据上下文自动触发。',
    aliases: ['sp', 'powers', 'workflow'],
    argumentHint: '[topic]',
    whenToUse:
      'Use at the start of any development work to follow systematic workflow: brainstorming → planning → TDD implementation → code review. The skills trigger automatically - you just say what you want to build.',
    userInvocable: true,
    files: {
      'SKILL.md': USING_SUPERPOWERS_GUIDE,
      'brainstorming/SKILL.md': BRAINSTORMING_SKILL,
      'test-driven-development/SKILL.md': TDD_SKILL,
      'writing-plans/SKILL.md': WRITING_PLANS_SKILL,
      'systematic-debugging/SKILL.md': SYSTEMATIC_DEBUGGING_SKILL,
      'subagent-driven-development/SKILL.md': SUBAGENT_DRIVEN_DEV_SKILL,
      'using-git-worktrees/SKILL.md': GIT_WORKTREES_SKILL,
      'finishing-a-development-branch/SKILL.md': FINISHING_BRANCH_SKILL,
      'requesting-code-review/SKILL.md': CODE_REVIEW_SKILL,
    },
    getPromptForCommand: async (args: string) => {
      const topic = args.trim()

      const basePrompt = `You are using the Superpowers skill framework for systematic software development.

## Superpowers Workflow

Superpowers provides a complete development workflow that triggers automatically:

1. **brainstorming** - Before writing code, explore requirements and create design
2. **using-git-worktrees** - Create isolated workspace for clean development  
3. **writing-plans** - Break work into bite-sized tasks (2-5 min each)
4. **subagent-driven-development** - Execute tasks with TDD and review
5. **requesting-code-review** - Self-review before completing
6. **finishing-a-development-branch** - Merge, PR, or discard

## Core Principles

- **Test-Driven Development** - RED (write failing test) → GREEN (minimal code) → REFACTOR
- **No Placeholders** - Every task has complete code, exact file paths
- **Verify Everything** - Watch tests fail, then pass. No assumptions.
- **Small Tasks** - Each task is 2-5 minutes of work
- **Delete Code Before TDD** - If you wrote code before tests, delete it and start over

## Skill Reference Files

Read these files for detailed guidance:
- @SKILL.md - Overview and getting started
- @brainstorming/SKILL.md - Design refinement workflow
- @test-driven-development/SKILL.md - TDD rules and cycle
- @writing-plans/SKILL.md - Implementation planning
- @systematic-debugging/SKILL.md - Debugging process
- @subagent-driven-development/SKILL.md - Task execution
- @using-git-worktrees/SKILL.md - Workspace isolation
- @finishing-a-development-branch/SKILL.md - Completion workflow
- @requesting-code-review/SKILL.md - Self-review checklist

## How to Use

The skills trigger automatically based on context. Just start working:
- "Let's build a user authentication system" → brainstorming activates
- "I'm seeing an error when..." → systematic-debugging activates  
- "I have a spec, let's implement it" → writing-plans activates

**Follow the skills. They are mandatory workflows, not suggestions.**`

      if (topic) {
        return [
          {
            type: 'text',
            text: `${basePrompt}\n\n## Current Topic\n\nThe user wants to work on: **${topic}**\n\nBased on this topic, determine which Superpowers skill should activate:\n\n1. If this is a new feature/component → Start with **brainstorming** skill\n2. If this is debugging/fixing something → Start with **systematic-debugging** skill\n3. If they have a spec ready → Start with **writing-plans** skill\n4. If they're in the middle of implementation → Continue with **subagent-driven-development** or **test-driven-development**\n\nRead the relevant skill file and follow its workflow exactly.`,
          },
        ]
      }

      return [
        {
          type: 'text',
          text: `${basePrompt}\n\nThe user invoked /superpowers without a specific topic. Present a brief overview of what Superpowers offers and ask what they'd like to work on.`,
        },
      ]
    },
  })
}
