/**
 * Auto-skill extraction via forked agent.
 *
 * Runs a background subagent that analyzes the current conversation for
 * repeatable multi-step patterns. When a high-confidence pattern is found,
 * writes a SKILL.md to .claude/skills/_auto_<name>/SKILL.md.
 *
 * Pattern mirrors extractMemories' runForkedAgent usage:
 * - Shares parent prompt cache (no model override)
 * - Read/Grep/Glob unrestricted, Bash read-only, Edit/Write restricted to skills dir
 * - Fire-and-forget — failures are silently logged
 */

import { join } from 'path'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  createMemorySavedMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import { getCwd } from '../../utils/cwd.js'
import { AUTO_SKILLIFY_PROMPT } from './prompts/autoSkillifyPrompt.js'

// ═══════════════════════════════════════════════════════════════════════════
// Tool names (same constants as extractMemories)
// ═══════════════════════════════════════════════════════════════════════════

import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { REPL_TOOL_NAME } from '../../tools/REPLTool/constants.js'

// ═══════════════════════════════════════════════════════════════════════════
// canUseTool — restricts writes to .claude/skills/ directory
// ═══════════════════════════════════════════════════════════════════════════

function isInSkillsDir(filePath: string, skillsDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  const normalizedDir = skillsDir.replace(/\\/g, '/')
  return normalized.startsWith(normalizedDir + '/') || normalized === normalizedDir
}

function createSkillWriteCanUseTool(skillsDir: string): CanUseToolFn {
  return async (
    tool: Tool,
    input: Record<string, unknown>,
  ) => {
    // Allow REPL — prompt cache sharing requires same tool list
    if (tool.name === REPL_TOOL_NAME) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Read/Grep/Glob unrestricted
    if (
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === GREP_TOOL_NAME ||
      tool.name === GLOB_TOOL_NAME
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Bash only for read-only commands
    if (tool.name === BASH_TOOL_NAME) {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success && tool.isReadOnly(parsed.data)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      logForDebugging(`[nudge] auto-skillify denied Bash: not read-only`)
      return {
        behavior: 'deny' as const,
        message: 'Only read-only shell commands are permitted',
        decisionReason: { type: 'other' as const, reason: 'read-only bash only' },
      }
    }

    // Allow Edit/Write only within .claude/skills/ directory
    if (
      (tool.name === FILE_EDIT_TOOL_NAME || tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && isInSkillsDir(filePath, skillsDir)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      logForDebugging(`[nudge] auto-skillify denied ${tool.name}: path outside skills dir`)
      return {
        behavior: 'deny' as const,
        message: `Only writes within ${skillsDir} are allowed`,
        decisionReason: { type: 'other' as const, reason: 'skills dir only' },
      }
    }

    logForDebugging(`[nudge] auto-skillify denied ${tool.name}: not permitted`)
    return {
      behavior: 'deny' as const,
      message: `Tool ${tool.name} is not permitted in this context`,
      decisionReason: { type: 'other' as const, reason: 'not allowed' },
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Response parsing — extract written file paths from agent output
// ═══════════════════════════════════════════════════════════════════════════

type SkillifyResult = {
  writtenPaths: string[]
}

function parseSkillifyResponse(messages: Message[]): SkillifyResult {
  const writtenPaths: string[] = []

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue
    const content = msg.message.content
    if (typeof content === 'string') continue
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (block.type !== 'tool_use') continue
      if (
        block.name !== FILE_EDIT_TOOL_NAME &&
        block.name !== FILE_WRITE_TOOL_NAME
      ) {
        continue
      }
      const input = block.input as { file_path?: unknown }
      if (typeof input?.file_path === 'string' && input.file_path.endsWith('SKILL.md')) {
        writtenPaths.push(input.file_path)
      }
    }
  }

  return { writtenPaths }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════════════════

export async function executeAutoSkillify(
  context: REPLHookContext,
): Promise<void> {
  const startTime = Date.now()
  const cwd = getCwd()
  const skillsDir = join(cwd, '.claude', 'skills')

  try {
    const prompt = AUTO_SKILLIFY_PROMPT
    const canUseTool = createSkillWriteCanUseTool(skillsDir)
    const cacheSafeParams = createCacheSafeParams(context)

    logForDebugging('[nudge] auto-skillify: starting forked agent')

    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: prompt })],
      cacheSafeParams,
      canUseTool,
      querySource: 'nudge_auto_skillify',
      forkLabel: 'nudge_auto_skillify',
      maxTurns: 3,
      skipTranscript: true,
    })

    const { writtenPaths } = parseSkillifyResponse(result.messages)

    if (writtenPaths.length > 0) {
      const appendSystemMessage = context.toolUseContext.appendSystemMessage
      if (appendSystemMessage) {
        appendSystemMessage(createMemorySavedMessage(writtenPaths))
      }
      logForDebugging(
        `[nudge] auto-skillify: created ${writtenPaths.length} skill(s) — ${writtenPaths.join(', ')} (${result.totalUsage.input_tokens + result.totalUsage.output_tokens}t, ${Date.now() - startTime}ms)`,
      )
    } else {
      logForDebugging(
        `[nudge] auto-skillify: no reusable pattern found (${Date.now() - startTime}ms)`,
      )
    }
  } catch (err) {
    logForDebugging(`[nudge] auto-skillify error: ${err}`)
  }
}
