import { feature } from 'bun:bundle'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { logEvent } from '../../services/analytics/index.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { isENOENT } from '../errors.js'

/**
 * Skill intent routing — automatically map natural-language input to slash
 * commands based on semantic keyword matching.  Runs entirely locally (no
 * LLM side-query) so latency is negligible and it works offline.
 *
 * Architecture (Stage 1 Enhanced):
 * - Each skill declares a set of trigger patterns (keywords / phrases).
 * - User input is scored against every skill via a composite matcher.
 * - Top-K candidates are returned (not just the best match).
 * - Ambiguity detection: if top1 - top2 < threshold, mark as ambiguous.
 * - Context awareness: recent skill usage boosts related skills.
 * - Per-skill adaptive thresholds (broad vs precise skills).
 * - User-defined extensions via ~/.claude/.skill-intents.json.
 *
 * Thresholds:
 * - Exact phrase match  → score 1.0   (always routes)
 * - Word overlap        → score 0.5+  (routes if above threshold)
 * - No match            → score 0.0   (falls through to normal prompt)
 *
 * Disable via env: SKILL_INTENT_ROUTER=0
 * Tune threshold:   SKILL_INTENT_THRESHOLD=0.6  (default 0.45)
 */

/* ── Trigger Pattern Database ── */

export type SkillTrigger = {
  skill: string
  patterns: string[]
  description: string
  threshold?: number      // Per-skill threshold override
  category?: string       // Skill category for context boosting
  isBroad?: boolean       // Broad skills need higher threshold
}

/**
 * Built-in trigger patterns for bundled / common skills.
 * Users can extend this by placing a `.skill-intents.json` in their
 * ~/.claude/ directory (loaded at runtime, merged with built-in patterns).
 */
const SKILL_TRIGGERS: readonly SkillTrigger[] = [
  {
    skill: 'brainstorming',
    patterns: [
      'brainstorm',
      '头脑风暴',
      '脑暴',
      '创意',
      '想法',
      'ideate',
      'explore idea',
      '发散思维',
      '想一些点子',
      '帮我构思',
      '有没有什么主意',
      '集思广益',
      '灵感',
      '创新思路',
      '方案探讨',
      '多角度思考',
      '头脑激荡',
      '思维导图',
      'open ideation',
      'generate ideas',
    ],
    description: 'Creative brainstorming and ideation',
    category: 'creative',
    isBroad: true,
  },
  {
    skill: 'chinese-code-review',
    patterns: [
      'code review',
      '审查代码',
      'review code',
      '代码审查',
      '审代码',
      'cr ',
      '/cr',
      '走查代码',
      '检查代码',
      '帮我看看代码',
      '这段代码有问题吗',
      '代码质量',
      '代码规范',
      '重构建议',
      '优化建议',
      '代码评审',
      'peer review',
      '代码检查',
      '看看这段代码',
      '帮我 review',
      '审查',           // 单独匹配
      'review',         // 英文单独匹配
      '走查',           // 单独匹配
      '检查',           // 单独匹配（注意：可能与其他skill冲突）
    ],
    description: 'Chinese code review',
    category: 'coding',
  },
  {
    skill: 'chinese-commit-conventions',
    patterns: [
      'commit',
      '提交规范',
      'commit message',
      'changelog',
      '提交信息',
      'git commit',
      '规范提交',
    ],
    description: 'Chinese Git commit conventions',
    category: 'git',
  },
  {
    skill: 'chinese-documentation',
    patterns: [
      '写文档',
      'documentation',
      '技术文档',
      '写作规范',
      '文档写作',
      'readme',
      '写 readme',
    ],
    description: 'Chinese technical documentation',
    category: 'writing',
  },
  {
    skill: 'chinese-git-workflow',
    patterns: [
      'git 工作流',
      'git workflow',
      '分支策略',
      '工作流规范',
      'git 规范',
      'gitee',
      'coding',
      'gitlab',
    ],
    description: 'Chinese Git workflow',
    category: 'git',
  },
  {
    skill: 'design-system',
    patterns: [
      'design system',
      '设计系统',
      '设计令牌',
      'design token',
      '组件规范',
      '幻灯片',
      'slide',
    ],
    description: 'Design system architecture',
    category: 'design',
  },
  {
    skill: 'dispatching-parallel-agents',
    patterns: [
      '并行',
      'parallel',
      '同时执行',
      '多个任务',
      '并行处理',
      '并行代理',
      '一起执行',
    ],
    description: 'Dispatch parallel agents',
    category: 'agent',
  },
  {
    skill: 'executing-plans',
    patterns: [
      '执行计划',
      '实施计划',
      '按计划执行',
      '执行方案',
    ],
    description: 'Execute written plans',
    category: 'planning',
  },
  {
    skill: 'finishing-a-development-branch',
    patterns: [
      '完成开发',
      '收尾',
      '合并分支',
      '结束开发',
      'finish branch',
      '开发收尾',
      '结束工作',
    ],
    description: 'Finish development branch',
    category: 'git',
  },
  {
    skill: 'frontend-design',
    patterns: [
      '前端设计',
      'ui 设计',
      '界面设计',
      'frontend design',
      '网页设计',
      '页面设计',
      'web design',
      '构建网页',
      'landing page',
      'dashboard',
      'react component',
      'html css',
      '海报',
      'artifact',
      '前端页面',
      '做网页',
      '写页面',
      '网站设计',
      'h5页面',
      '响应式',
      '自适应布局',
      'ui',           // 宽泛匹配
      '界面',         // 宽泛匹配
      '网页',         // 宽泛匹配
      '页面',         // 宽泛匹配
    ],
    description: 'Frontend interface design',
    category: 'design',
    isBroad: true,
  },
  {
    skill: 'mcp-builder',
    patterns: [
      'mcp',
      '构建 mcp',
      'mcp 服务器',
      'mcp server',
      'mcp 工具',
      'model context protocol',
    ],
    description: 'MCP server builder',
    category: 'mcp',
  },
  {
    skill: 'receiving-code-review',
    patterns: [
      '收到审查',
      '处理反馈',
      'review 反馈',
      '代码反馈',
      '评审意见',
    ],
    description: 'Receiving code review feedback',
    category: 'coding',
  },
  {
    skill: 'requesting-code-review',
    patterns: [
      '请求审查',
      '发起 cr',
      '发起 review',
      '请求 code review',
      '请人审查',
    ],
    description: 'Requesting code review',
    category: 'coding',
  },
  {
    skill: 'subagent-driven-development',
    patterns: [
      '子代理',
      'subagent',
      '子智能体',
      '多代理',
      'multi agent',
    ],
    description: 'Subagent-driven development',
    category: 'agent',
  },
  {
    skill: 'svg-design',
    patterns: [
      'svg',
      '图标设计',
      'logo',
      '矢量图',
      'svg 动画',
      'icon',
      '矢量图标',
    ],
    description: 'SVG design',
    category: 'design',
  },
  {
    skill: 'systematic-debugging',
    patterns: [
      '调试',
      'debug',
      '排查问题',
      'bug',
      '定位问题',
      'troubleshooting',
      '修复 bug',
      '找 bug',
      '报错',
      '错误信息',
      '运行失败',
      '崩溃',
      '异常',
      'stack trace',
      'segmentation fault',
      '卡死',
      '无响应',
      '性能问题',
      '内存泄漏',
      '死锁',
      'race condition',
    ],
    description: 'Systematic debugging',
    category: 'debug',
  },
  {
    skill: 'test-driven-development',
    patterns: [
      'tdd',
      '测试驱动',
      '先写测试',
      'test driven',
      '单元测试',
      '测试先行',
    ],
    description: 'Test-driven development',
    category: 'coding',
  },
  {
    skill: 'ui-ux-pro-max',
    patterns: [
      'ui/ux',
      '界面优化',
      '用户体验',
      'ux 设计',
      'ui 优化',
      '交互设计',
      '审查 ui',
      '检查界面',
      'gui',
      'glassmorphism',
      '配色',
      'ui 审查',
      '界面审查',
      'ui review',
      '设计审查',
      'ui 问题',
      '界面问题',
    ],
    description: 'UI/UX pro max design',
    category: 'design',
    isBroad: true,
  },
  {
    skill: 'using-git-worktrees',
    patterns: [
      'git worktree',
      'worktree',
      '隔离开发',
      '并行开发',
      '多个工作区',
    ],
    description: 'Git worktrees',
    category: 'git',
  },
  {
    skill: 'using-superpowers',
    patterns: [
      'superpowers',
      '技能使用',
      '怎么用 skill',
      'skill 怎么用',
      '使用技能',
      '有哪些技能',
      '有什么 skill',
    ],
    description: 'Using superpowers/skills',
    category: 'help',
  },
  {
    skill: 'verification-before-completion',
    patterns: [
      '验证',
      '检查完成',
      '确认完成',
      '验证通过',
      '完成检查',
      '验收',
    ],
    description: 'Verification before completion',
    category: 'qa',
  },
  {
    skill: 'workflow-runner',
    patterns: [
      'workflow',
      '工作流',
      'yaml 工作流',
      'agency orchestrator',
      '运行工作流',
      '执行 workflow',
    ],
    description: 'Workflow runner',
    category: 'automation',
  },
  {
    skill: 'writing-plans',
    patterns: [
      '写计划',
      '制定计划',
      '做规划',
      '写方案',
      '实施方案',
      '开发计划',
    ],
    description: 'Writing implementation plans',
    category: 'planning',
  },
  {
    skill: 'writing-skills',
    patterns: [
      '创建 skill',
      '写 skill',
      '创建技能',
      '自定义 skill',
      'skill 开发',
      '新技能',
    ],
    description: 'Writing skills',
    category: 'meta',
  },
  {
    skill: 'kimi-cli-help',
    patterns: [
      'kimi 帮助',
      'kimi 怎么用',
      'cli 帮助',
      '快捷键',
      'keyboard shortcut',
      'mcp 集成',
      'provider',
      '环境变量',
    ],
    description: 'Kimi CLI help',
    category: 'help',
  },
  {
    skill: 'skill-creator',
    patterns: [
      'skill creator',
      '技能创建器',
      'skill 指南',
      'skill 教程',
    ],
    description: 'Skill creator guide',
    category: 'meta',
  },
]

/* ── User-defined Extension Loading ── */

export type UserSkillIntent = {
  patterns?: string[]
  threshold?: number
  category?: string
  isBroad?: boolean
}

let userSkillIntents: Map<string, UserSkillIntent> | null = null
let userIntentsLoaded = false

/**
 * Load user-defined skill intents from ~/.claude/.skill-intents.json
 * Format: { "skillName": { "patterns": ["..."], "threshold": 0.4 } }
 */
async function loadUserSkillIntents(): Promise<Map<string, UserSkillIntent>> {
  if (userIntentsLoaded) return userSkillIntents ?? new Map()
  userIntentsLoaded = true

  const configDir = getClaudeConfigHomeDir()
  const filePath = join(configDir, '.skill-intents.json')

  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content) as Record<string, UserSkillIntent>
    userSkillIntents = new Map(Object.entries(parsed))
    // Clear cache so new user intents take effect
    clearEffectiveTriggerCache()
    return userSkillIntents
  } catch (e) {
    if (!isENOENT(e)) {
      // Silently ignore parse errors — user file is optional
    }
    userSkillIntents = new Map()
    return userSkillIntents
  }
}

/**
 * Synchronously get user intents (returns empty map if not yet loaded).
 * Called on hot path; async loading happens in background.
 */
function getUserSkillIntentsSync(): Map<string, UserSkillIntent> {
  if (!userIntentsLoaded) {
    // Kick off async load, but return empty for this call
    loadUserSkillIntents().catch(() => {})
    return new Map()
  }
  return userSkillIntents ?? new Map()
}

/**
 * Force reload user-defined skill intents from disk.
 * Call this after modifying ~/.claude/.skill-intents.json.
 */
export async function reloadUserSkillIntents(): Promise<void> {
  userIntentsLoaded = false
  userSkillIntents = null
  clearEffectiveTriggerCache()
  await loadUserSkillIntents()
}

/* ── Context Awareness ── */

const CONTEXT_WINDOW_SIZE = 3
const CONTEXT_BOOST = 0.1
const recentSkills: { skill: string; category?: string }[] = []

/**
 * Record a skill invocation for context tracking.
 * Called by the router when a skill is successfully matched.
 */
export function recordSkillUsage(skill: string, category?: string): void {
  recentSkills.unshift({ skill, category })
  if (recentSkills.length > CONTEXT_WINDOW_SIZE) {
    recentSkills.pop()
  }
}

/**
 * Get context boost for a skill based on recent usage.
 */
function getContextBoost(category?: string): number {
  if (!category) return 0
  const hasRecentMatch = recentSkills.some(r => r.category === category)
  return hasRecentMatch ? CONTEXT_BOOST : 0
}

/* ── Scoring Engine ── */

const DEFAULT_THRESHOLD = 0.45
const BROAD_SKILL_PENALTY = 0.05  // Broad skills need higher score
const AMBIGUITY_GAP = 0.15        // Top1 - Top2 < this → ambiguous

function getThreshold(): number {
  const env = process.env.SKILL_INTENT_THRESHOLD
  if (!env) return DEFAULT_THRESHOLD
  const n = Number.parseFloat(env)
  return Number.isNaN(n) ? DEFAULT_THRESHOLD : Math.max(0.1, Math.min(1.0, n))
}

/**
 * Get effective threshold for a specific skill.
 */
function getSkillThreshold(trigger: SkillTrigger): number {
  const base = trigger.threshold ?? getThreshold()
  if (trigger.isBroad) {
    return Math.min(1.0, base + BROAD_SKILL_PENALTY)
  }
  return base
}

/**
 * Synonym expansion for common technical terms.
 * Maps variants to canonical forms for better matching.
 */
const SYNONYMS: Record<string, string[]> = {
  '代码': ['程序', '源码', '源代码', 'code'],
  '调试': ['debug', 'troubleshoot', '排查', '诊断'],
  '审查': ['review', '检查', '走查', '评审'],
  '设计': ['design', '规划', '构思'],
  '测试': ['test', '验证', '检验'],
  '文档': ['doc', 'documentation', '说明'],
  '提交': ['commit', '签入', 'checkin'],
  '分支': ['branch'],
  '合并': ['merge'],
  '重构': ['refactor', '重写', '改造'],
  '优化': ['optimize', '改进', '提升', 'performance'],
  'bug': ['缺陷', '问题', '错误', '故障'],
}

/**
 * Pinyin mapping for common technical terms.
 * Enables matching pinyin input to Chinese terms.
 */
const PINYIN_MAP: Record<string, string> = {
  'daima': '代码',
  'tiaoshi': '调试',
  'shencha': '审查',
  'sheji': '设计',
  'ceshi': '测试',
  'wendang': '文档',
  'tijiao': '提交',
  'fenzhi': '分支',
  'hebing': '合并',
  'chonggou': '重构',
  'youhua': '优化',
  'paicha': '排查',
  'zhenduan': '诊断',
  'jiejue': '解决',
  'went': '问题',
}

/**
 * Expand pinyin in input to Chinese characters.
 */
function expandPinyin(text: string): string {
  let expanded = text
  for (const [pinyin, chinese] of Object.entries(PINYIN_MAP)) {
    if (text.includes(pinyin)) {
      expanded += ' ' + chinese
    }
  }
  return expanded
}

/**
 * Expand input text with synonyms for richer matching.
 * E.g. "排查代码问题" → "排查代码问题 debug troubleshoot 审查 检查 ..."
 */
function expandSynonyms(text: string): string {
  // First expand pinyin, then synonyms
  const pinyinExpanded = expandPinyin(text)
  let expanded = pinyinExpanded

  for (const [canonical, variants] of Object.entries(SYNONYMS)) {
    // If text contains any variant, add all other variants
    const hasMatch = variants.some(v => pinyinExpanded.includes(v)) || pinyinExpanded.includes(canonical)
    if (hasMatch) {
      const additions = [canonical, ...variants].filter(v => !pinyinExpanded.includes(v))
      if (additions.length > 0) {
        expanded += ' ' + additions.join(' ')
      }
    }
  }
  return expanded
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .trim()
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(Boolean))
}

/**
 * Compute Jaccard similarity between two token sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const x of a) {
    if (b.has(x)) intersection++
  }
  return intersection / (a.size + b.size - intersection)
}

/**
 * Check if input contains negation words that should suppress matching.
 */
function hasNegation(input: string): boolean {
  const negationPatterns = [
    '不要', '别', '不需要', '不用', '不想', '不打算', '别给我',
    'no need', 'don\'t', 'do not', 'never', 'avoid', 'skip',
  ]
  const normalized = normalize(input)
  return negationPatterns.some(n => normalized.includes(n))
}

/**
 * Score a single pattern against user input.
 * Returns 0.0–1.0.
 */
function scorePattern(input: string, pattern: string): number {
  const nInput = normalize(input)
  const nPattern = normalize(pattern)

  // Exact substring match (highest confidence)
  if (nInput.includes(nPattern)) {
    // Longer patterns matched in full are stronger signals
    const coverage = nPattern.length / Math.max(nInput.length, 1)
    // Boost for Chinese keywords (typically shorter but more precise)
    const isChinese = /[\u4e00-\u9fa5]/.test(nPattern)
    const chineseBoost = isChinese ? 0.1 : 0
    return Math.min(1.0, 0.7 + 0.3 * coverage + chineseBoost)
  }

  // Prefix match (e.g. "commit" matches "commits" and "committed")
  // Only for tokens with length >= 3 to avoid false positives
  const inputTokens = Array.from(tokenize(input))
  const patternTokens = Array.from(tokenize(pattern))
  for (const pt of patternTokens) {
    if (pt.length < 3) continue
    for (const it of inputTokens) {
      if (it.length < 3) continue
      if (it.startsWith(pt) || pt.startsWith(it)) {
        const coverage = Math.min(it.length, pt.length) / Math.max(it.length, pt.length)
        return 0.5 + 0.2 * coverage
      }
    }
  }

  // Token-level Jaccard for partial overlap
  const inputSet = tokenize(input)
  const patternSet = tokenize(pattern)
  const sim = jaccard(inputSet, patternSet)
  return sim * 0.45 // cap at 0.45 for non-exact matches
}

/**
 * Score a skill against user input.
 * Returns the maximum score across all patterns.
 */
function scoreSkill(input: string, trigger: SkillTrigger): number {
  // Suppress if negation detected and skill is not a "help" skill
  if (hasNegation(input) && !trigger.skill.includes('help')) {
    const positivePatterns = trigger.patterns.filter(p => {
      const np = normalize(p)
      return !np.includes('帮助') && !np.includes('help') && !np.includes('怎么用')
    })
    if (positivePatterns.length === 0) return 0
    let best = 0
    for (const pattern of positivePatterns) {
      const s = scorePattern(input, pattern)
      if (s > best) best = s
    }
    return best * 0.7 // penalize negated requests
  }

  let best = 0
  for (const pattern of trigger.patterns) {
    const s = scorePattern(input, pattern)
    if (s > best) best = s
  }
  return best
}

/* ── Internal Routing Core ── */

type ScoredSkill = {
  skill: string
  score: number
  trigger: SkillTrigger
}

/**
 * Build effective trigger by merging user-defined overrides.
 * Cached to avoid rebuilding on every input.
 */
const effectiveTriggerCache = new Map<string, SkillTrigger>()

function buildEffectiveTrigger(base: SkillTrigger): SkillTrigger {
  const cached = effectiveTriggerCache.get(base.skill)
  if (cached) return cached

  const userIntents = getUserSkillIntentsSync()
  const userIntent = userIntents.get(base.skill)
  if (!userIntent) {
    effectiveTriggerCache.set(base.skill, base)
    return base
  }

  const effective = {
    ...base,
    patterns: userIntent.patterns
      ? [...base.patterns, ...userIntent.patterns]
      : base.patterns,
    threshold: userIntent.threshold ?? base.threshold,
    category: userIntent.category ?? base.category,
    isBroad: userIntent.isBroad ?? base.isBroad,
  }
  effectiveTriggerCache.set(base.skill, effective)
  return effective
}

/**
 * Clear the effective trigger cache (called when user intents are reloaded).
 */
function clearEffectiveTriggerCache(): void {
  effectiveTriggerCache.clear()
}

/**
 * Score all skills and return candidates sorted by score descending.
 * Applies context boost, synonym expansion, and merges user-defined patterns.
 */
function scoreAllSkills(input: string): ScoredSkill[] {
  const expandedInput = expandSynonyms(input)
  const results: ScoredSkill[] = []

  for (const trigger of SKILL_TRIGGERS) {
    const effectiveTrigger = buildEffectiveTrigger(trigger)
    // Score against both original and expanded input, take max
    const originalScore = scoreSkill(input, effectiveTrigger)
    const expandedScore = scoreSkill(expandedInput, effectiveTrigger)
    let baseScore = Math.max(originalScore, expandedScore)

    // Apply context boost
    const contextBoost = getContextBoost(effectiveTrigger.category)
    const finalScore = Math.min(1.0, baseScore + contextBoost)

    results.push({
      skill: effectiveTrigger.skill,
      score: finalScore,
      trigger: effectiveTrigger,
    })
  }

  // Sort by score descending, filter out zero scores for cleaner results
  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Determine if the top result is ambiguous (close competitor).
 */
function checkAmbiguity(topResults: ScoredSkill[]): {
  isAmbiguous: boolean
  alternatives: { skill: string; score: number }[]
} {
  if (topResults.length < 2) {
    return { isAmbiguous: false, alternatives: [] }
  }

  const top1 = topResults[0]!
  const top2 = topResults[1]!
  const gap = top1.score - top2.score

  if (gap < AMBIGUITY_GAP && top2.score >= getSkillThreshold(top2.trigger)) {
    // Return top competitors as alternatives
    const alternatives = topResults
      .slice(1)
      .filter(r => r.score >= getSkillThreshold(r.trigger))
      .slice(0, 2)
      .map(r => ({ skill: r.skill, score: r.score }))
    return { isAmbiguous: true, alternatives }
  }

  return { isAmbiguous: false, alternatives: [] }
}

/* ── Public API ── */

export type IntentRouterResult =
  | {
      matched: true
      skill: string
      score: number
      rewrittenInput: string
      isAmbiguous?: boolean
      alternatives?: { skill: string; score: number }[]
    }
  | { matched: false }

/**
 * Analyze user input and route to the best-matching skill if confidence
 * exceeds the threshold.
 *
 * Stage 1 Enhancements:
 * - Top-K recall: evaluates all skills, picks best from top candidates
 * - Ambiguity detection: flags when top2 is close to top1
 * - Context awareness: boosts skills in same category as recent usage
 * - Per-skill thresholds: broad skills need higher confidence
 * - User extensions: merges ~/.claude/.skill-intents.json patterns
 *
 * @param input Raw user input (non-slash-command, non-empty)
 */
function isIntentRouterEnabled(): boolean {
  // Runtime override takes precedence over compile-time flag
  if (process.env.SKILL_INTENT_ROUTER === '0') return false
  if (process.env.SKILL_INTENT_ROUTER === '1') return true
  // Fall back to compile-time feature flag (must be in if/ternary directly)
  if (feature('SKILL_INTENT_ROUTER')) return true
  return false
}

export function routeSkillIntent(input: string): IntentRouterResult {
  if (!isIntentRouterEnabled()) return { matched: false }

  const trimmed = input.trim()
  if (trimmed.length < 3 || !hasMeaningfulContent(trimmed)) {
    return { matched: false }
  }

  const scored = scoreAllSkills(trimmed)
  if (scored.length === 0) return { matched: false }

  const top1 = scored[0]!
  const effectiveThreshold = getSkillThreshold(top1.trigger)

  if (top1.score >= effectiveThreshold) {
    // Record usage for context tracking
    recordSkillUsage(top1.skill, top1.trigger.category)

    const { isAmbiguous, alternatives } = checkAmbiguity(scored)

    logEvent('tengu_skill_intent_route', {
      score: Math.round(top1.score * 100),
      threshold: Math.round(effectiveThreshold * 100),
      ambiguous: isAmbiguous,
    })

    return {
      matched: true,
      skill: top1.skill,
      score: top1.score,
      rewrittenInput: `/${top1.skill} ${trimmed}`,
      isAmbiguous,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    }
  }

  return { matched: false }
}

/**
 * Check if input contains meaningful content (not just special chars).
 */
function hasMeaningfulContent(input: string): boolean {
  // Require at least some letters or Chinese characters
  return /[a-zA-Z\u4e00-\u9fa5]/.test(input)
}

/**
 * Preview which skill (if any) would match, without rewriting.
 * Useful for UI hints (e.g. "Press Enter to invoke /brainstorming").
 * Returns top match + ambiguity info for UI rendering.
 */
export function previewSkillIntent(input: string): {
  skill: string | null
  score: number
  isAmbiguous: boolean
  alternatives: { skill: string; score: number }[]
} {
  if (!isIntentRouterEnabled()) {
    return { skill: null, score: 0, isAmbiguous: false, alternatives: [] }
  }

  const trimmed = input.trim()
  if (trimmed.length < 3 || !hasMeaningfulContent(trimmed)) {
    return { skill: null, score: 0, isAmbiguous: false, alternatives: [] }
  }

  const scored = scoreAllSkills(trimmed)
  if (scored.length === 0) {
    return { skill: null, score: 0, isAmbiguous: false, alternatives: [] }
  }

  const top1 = scored[0]!
  const { isAmbiguous, alternatives } = checkAmbiguity(scored)

  return {
    skill: top1.skill,
    score: top1.score,
    isAmbiguous,
    alternatives,
  }
}
