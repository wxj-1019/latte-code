/**
 * Prompt for the auto-skillify forked agent.
 *
 * Analyzes the conversation above for repeatable multi-step patterns.
 * Writes a SKILL.md ONLY when a high-confidence reusable pattern is found.
 * Silently returns nothing when no clear pattern exists.
 */

export const AUTO_SKILLIFY_PROMPT = `# Auto Skill Capture

You are analyzing a conversation to identify repeatable multi-step processes that should be saved as reusable skills.

## Instructions

### Step 1: Scan the conversation above for patterns

Look for:
- Multi-step workflows the user guided you through
- Processes involving multiple tools (Bash, Read, Write, Edit, Grep, Glob)
- Sequences that the user repeated or explicitly asked you to remember
- Tasks where the user corrected or steered your approach

### Step 2: Decide whether to capture

Capture ONLY when the pattern is CLEARLY reusable. Skip when:
- The conversation is simple Q&A or one-shot code generation
- No distinct multi-step workflow is visible
- The task was purely investigative (debugging, exploration)
- The task was so context-specific it won't generalize
- A similar skill already exists in .claude/skills/ (check with Grep/Glob first!)

### Step 3: Write the skill file (if capturing)

Create a directory and SKILL.md at:
  .claude/skills/_auto_<kebab-case-name>/SKILL.md

Use this format:

\`\`\`markdown
---
name: <kebab-case-name>
description: <one-line summary>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
when_to_use: Use when the user wants to <goal>. Examples: '<example1>', '<example2>'
auto-generated: true
---

# <Title>

## Goal
<One sentence: what this skill accomplishes>

## Steps

### 1. <Step Name>
<What to do>

**Success criteria**: <How to know this step is done>

### 2. <Step Name>
...
\`\`\`

**Rules:**
- Use \`_auto_\` prefix on the directory name so auto-generated skills are distinguishable
- \`when_to_use\` MUST include concrete trigger phrases the user might say
- Keep skills concise — 2-5 steps, no fluff
- Check for duplicates before writing (use Grep/Glob to scan existing skills)
- If nothing clearly reusable: silently return with no output and no file writes

You have a limited turn budget (3 turns). Use them efficiently:
- Turn 1: Read existing skill list + analyze conversation
- Turn 2: Write the SKILL.md (only if a pattern was found)
- Do not ask questions — this is fully automated`
