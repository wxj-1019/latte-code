/**
 * Smart Approval — Three-tier guardian approval engine.
 *
 * Enhances the existing binary YOLO classifier (block / don't-block)
 * with a three-tier classification:
 *
 *   1. SILENT_APPROVE  → Safe, no user prompt needed
 *   2. ESCALATE        → Suspicious, show to user for explicit confirmation
 *   3. BLOCK           → Dangerous, auto-deny without prompting user
 *
 * Architecture:
 *   - Tier 1 (fast path): Tool whitelist + simple pattern rules — zero latency
 *   - Tier 2 (AI guardian): Lightweight sub-agent evaluation of operation safety
 *   - Tier 3 (fallback): Default to ESCALATE when guardian unavailable
 *
 * Integrates with the existing `SAFE_YOLO_ALLOWLISTED_TOOLS` whitelist
 * and the YOLO classifier pipeline in `permissions.ts`.
 */

import { isAutoModeAllowlistedTool } from './classifierDecision.js'

// ═════════════════════════════════════════
// Types
// ═════════════════════════════════════════

export enum ApprovalTier {
  /** Safe operation — silently approve, no user prompt */
  SILENT_APPROVE = 'silent_approve',
  /** Suspicious operation — escalate to user for confirmation */
  ESCALATE = 'escalate',
  /** Dangerous operation — auto-block, notify user */
  BLOCK = 'block',
}

export interface ApprovalDecision {
  tier: ApprovalTier
  reason: string
  /** Risk score 0-100, higher = more dangerous */
  riskScore: number
  /** Which layer made the decision */
  source: 'whitelist' | 'pattern' | 'guardian' | 'default'
}

export interface GuardianContext {
  toolName: string
  operationDescription: string
  workingDirectory: string
  /** Recent conversation context for the guardian to evaluate */
  recentActions?: string[]
}

// ═════════════════════════════════════════
// Risk score thresholds
// ═════════════════════════════════════════

const RISK_THRESHOLD_SILENT = 20   // Score < 20 → SILENT_APPROVE
const RISK_THRESHOLD_BLOCK = 80    // Score >= 80 → BLOCK
// 20 <= score < 80 → ESCALATE

// ═════════════════════════════════════════
// Tier 1: Fast Path (Whitelist + Simple Patterns)
// ═════════════════════════════════════════

/**
 * Check if an operation is clearly safe and can be silently approved.
 * This is the zero-latency fast path that runs before any AI evaluation.
 */
function fastPathCheck(
  toolName: string,
  operationDescription: string,
): ApprovalDecision | null {
  // Whitelist: these tools are always safe
  if (isAutoModeAllowlistedTool(toolName)) {
    return {
      tier: ApprovalTier.SILENT_APPROVE,
      reason: `Tool "${toolName}" is on the safe whitelist`,
      riskScore: 0,
      source: 'whitelist',
    }
  }

  // Simple pattern rules for Bash operations
  if (toolName === 'Bash' || toolName === 'BashTool') {
    return analyzeBashPattern(operationDescription)
  }

  // For read-like operations, score low
  if (toolName === 'Read' || toolName === 'WebFetch' || toolName === 'WebSearch') {
    return {
      tier: ApprovalTier.SILENT_APPROVE,
      reason: `Read-only tool "${toolName}" is safe`,
      riskScore: 5,
      source: 'pattern',
    }
  }

  // Can't determine without guardian — defer to next tier
  return null
}

/**
 * Pattern-based analysis of bash commands.
 * Returns null if the pattern isn't clearly safe or dangerous.
 */
function analyzeBashPattern(description: string): ApprovalDecision | null {
  const cmd = description.toLowerCase()

  // Clearly safe patterns
  const safePatterns = [
    /^git\s+status\b/,
    /^git\s+diff\b/,
    /^git\s+log\b/,
    /^git\s+branch\b/,
    /^ls\b/,
    /^echo\b/,
    /^pwd\b/,
    /^which\b/,
    /^cat\b/,
    /^head\b/,
    /^tail\b/,
    /^wc\b/,
    /^date\b/,
    /^whoami\b/,
    /^node\s+(-v|--version)\b/,
    /^npm\s+ls\b/,
    /^bun\s+(-v|--version)\b/,
    /^gh\s+pr\s+view\b/,
    /^gh\s+pr\s+list\b/,
    /^gh\s+issue\s+list\b/,
  ]

  for (const pattern of safePatterns) {
    if (pattern.test(cmd)) {
      return {
        tier: ApprovalTier.SILENT_APPROVE,
        reason: `Bash command matches safe pattern: ${description.slice(0, 80)}`,
        riskScore: 5,
        source: 'pattern',
      }
    }
  }

  // Clearly dangerous patterns
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,
    /sudo\b/,
    /chmod\s+777/,
    /curl.*\|\s*(ba)?sh/,
    /wget.*\|\s*(ba)?sh/,
    />\s*\/dev\/(sda|nvme|mmcblk)/,
    /mkfs\./,
    /dd\s+if=/,
    /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,  // fork bomb
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd)) {
      return {
        tier: ApprovalTier.BLOCK,
        reason: `Bash command matches dangerous pattern: ${description.slice(0, 80)}`,
        riskScore: 95,
        source: 'pattern',
      }
    }
  }

  // For other bash commands: can't determine from pattern alone
  return null
}

// ═════════════════════════════════════════
// Tier 2: AI Guardian (Lightweight Safety Evaluation)
// ═════════════════════════════════════════

/**
 * Evaluate an operation's safety using a lightweight guardian prompt.
 * This is the second tier, invoked only when fast-path can't decide.
 */
export function buildGuardianPrompt(context: GuardianContext): string {
  const recentActionsText = context.recentActions?.length
    ? `\n## Recent Operations\nThe following were recently performed:\n${context.recentActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    : ''

  return `# Safety Guardian

Evaluate the safety of the following operation. Respond with a risk score (0-100) and a brief reason.

## Operation
- **Tool**: ${context.toolName}
- **Action**: ${context.operationDescription}
- **Working Directory**: ${context.workingDirectory}${recentActionsText}

## Risk Scoring Guide

| Score | Category | Example |
|-------|----------|---------|
| 0-19 | Safe | Reading files, listing directories, git status |
| 20-49 | Low Risk | Creating files, installing packages, writing to workspace |
| 50-79 | Medium Risk | Modifying configs, deleting workspace files, network requests |
| 80-100 | High Risk | Deleting outside workspace, sudo, destructive ops, piping scripts |

## Rules
1. Operations INSIDE the working directory are generally safe (score < 50)
2. Operations OUTSIDE the working directory need careful evaluation
3. Operations that modify system files or use sudo are HIGH RISK
4. Network operations to untrusted endpoints are HIGH RISK
5. Git operations (not force push) in the workspace are generally safe
6. Package installation (npm/bun/pip) inside the workspace is LOW RISK

Respond with ONLY a JSON object:
{"riskScore": <0-100>, "reason": "<brief explanation>"}`
}

/**
 * Parse a guardian's JSON response into a risk score.
 */
export function parseGuardianResponse(
  response: string,
): { riskScore: number; reason: string } | null {
  try {
    // Try to find a JSON object in the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (
      typeof parsed.riskScore !== 'number' ||
      typeof parsed.reason !== 'string'
    ) {
      return null
    }

    // Clamp risk score to valid range
    parsed.riskScore = Math.max(0, Math.min(100, parsed.riskScore))
    return parsed
  } catch {
    return null
  }
}

/**
 * Map a risk score to an approval tier.
 */
export function riskScoreToTier(riskScore: number): ApprovalTier {
  if (riskScore < RISK_THRESHOLD_SILENT) return ApprovalTier.SILENT_APPROVE
  if (riskScore >= RISK_THRESHOLD_BLOCK) return ApprovalTier.BLOCK
  return ApprovalTier.ESCALATE
}

// ═════════════════════════════════════════
// Main API
// ═════════════════════════════════════════

/**
 * Evaluate an operation and return an approval decision.
 *
 * Flow:
 *   1. Fast path (whitelist + patterns) → return immediately if clear
 *   2. Guardian evaluates → risk score → tier
 *   3. Default: ESCALATE (safe default)
 */
export function evaluateApproval(
  toolName: string,
  operationDescription: string,
  guardianRiskScore?: number | null,
  guardianReason?: string,
): ApprovalDecision {
  // Tier 1: Fast path
  const fastResult = fastPathCheck(toolName, operationDescription)
  if (fastResult) return fastResult

  // Tier 2: Guardian evaluation (if available)
  if (guardianRiskScore !== null && guardianRiskScore !== undefined) {
    const tier = riskScoreToTier(guardianRiskScore)
    return {
      tier,
      reason: guardianReason || `Guardian risk score: ${guardianRiskScore}`,
      riskScore: guardianRiskScore,
      source: 'guardian',
    }
  }

  // Tier 3: Default fallback
  return {
    tier: ApprovalTier.ESCALATE,
    reason: `No guardian result for tool "${toolName}" — defaulting to escalate`,
    riskScore: 50,
    source: 'default',
  }
}

/**
 * Check if an approval decision allows silent execution.
 */
export function isSilentlyApproved(decision: ApprovalDecision): boolean {
  return decision.tier === ApprovalTier.SILENT_APPROVE
}

/**
 * Check if an approval decision requires user escalation.
 */
export function requiresUserInput(decision: ApprovalDecision): boolean {
  return decision.tier === ApprovalTier.ESCALATE
}

/**
 * Check if an approval decision should be auto-blocked.
 */
export function isBlocked(decision: ApprovalDecision): boolean {
  return decision.tier === ApprovalTier.BLOCK
}

// ═════════════════════════════════════════
// Statistics
// ═════════════════════════════════════════

let approvalStats = {
  silentApproves: 0,
  escalations: 0,
  blocks: 0,
  fromWhitelist: 0,
  fromPattern: 0,
  fromGuardian: 0,
  fromDefault: 0,
}

export function recordApprovalDecision(decision: ApprovalDecision): void {
  switch (decision.tier) {
    case ApprovalTier.SILENT_APPROVE:
      approvalStats.silentApproves++
      break
    case ApprovalTier.ESCALATE:
      approvalStats.escalations++
      break
    case ApprovalTier.BLOCK:
      approvalStats.blocks++
      break
  }

  switch (decision.source) {
    case 'whitelist':
      approvalStats.fromWhitelist++
      break
    case 'pattern':
      approvalStats.fromPattern++
      break
    case 'guardian':
      approvalStats.fromGuardian++
      break
    case 'default':
      approvalStats.fromDefault++
      break
  }
}

export function getApprovalStats(): Readonly<typeof approvalStats> {
  return { ...approvalStats }
}

export function resetApprovalStats(): void {
  approvalStats = {
    silentApproves: 0,
    escalations: 0,
    blocks: 0,
    fromWhitelist: 0,
    fromPattern: 0,
    fromGuardian: 0,
    fromDefault: 0,
  }
}
