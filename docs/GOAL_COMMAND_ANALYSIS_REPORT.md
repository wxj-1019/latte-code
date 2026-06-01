# /goal 命令深度分析与优化方案

## 一、现有系统架构评估

### 1.1 核心优势（已具备企业级雏形）

你的 `/goal` 系统已经覆盖了当前主流 Autonomous Agent 框架的**六大基础支柱**：

| 模块 | 实现度 | 对标论文/项目 |
|------|--------|--------------|
| **生命周期管理** | ⭐⭐⭐⭐⭐ | 完整状态机 (created → active ⇄ paused → complete) |
| **预算控制** | ⭐⭐⭐⭐ | Turn 级预算 + 双阈值资源警告 |
| **自我反思** | ⭐⭐⭐⭐⭐ | Reflexion 模式 (5-turn 间隔 + 2000ms cooldown) |
| **情景记忆** | ⭐⭐⭐⭐ | Episodic Memory (max 20, 注入上限 3) |
| **技能库** | ⭐⭐⭐⭐ | Voyager 模式 (max 30, 按成功率排序) |
| **子任务分解** | ⭐⭐⭐⭐⭐ | DAG 依赖图 + 优先级 + 并行标记 |
| **企业特性** | ⭐⭐⭐⭐⭐ | 审计日志、指标、磁盘持久化、Webhook |

### 1.2 关键短板（与 2026 主流方案对比）

| 短板 | 当前实现 | 2026 主流方案 | 影响等级 | 状态 |
|------|---------|-------------|---------|------|
| **完成验证** | 依赖 `[GOAL_COMPLETED]` 文本标记 | **独立验证器 (Critic)** 冷启动验证 | 🔴 高 | ⬜ 待实现 |
| **并行执行** | 仅 advisory，模型需自行并行工具调用 | **框架级原生并行** (W&D 3-call/turn) | 🔴 高 | ⬜ 待实现 |
| **成本护栏** | 仅 `maxTurns` | **Token 成本预算** + 费用预警 | 🟡 中 | ✅ 已实现 |
| **技能生命周期** | 单调增长，无淘汰 | **Demotion Blacklist** + 在线蒸馏 | 🟡 中 | ✅ 已实现 |
| **记忆压缩** | 全量注入 | **AGORA 无推理压缩** / 滑动窗口 | 🟡 中 | ✅ 已实现 |
| **多 Agent 编排** | 单 Agent 循环 | **Supervisor-Worker** 分层验证 | 🟢 低 | ⬜ 待实现 |
| **自动工具链验证** | Condition 模式依赖模型自评 | **Auto-Verify** 调用项目测试/编译命令 | 🔴 高 | ✅ 已实现 |

---

## 二、相似项目调研

### 2.1 直接竞品：Claude Code 官方 `/goal` (2026-05-12, v2.1.139)

Anthropic 在 2026 年 5 月发布的官方 `/goal` 命令与你的架构高度相似，但引入了**关键差异点**：

- **独立验证器架构**：当主 Agent 认为完成时，会启动一个**全新的、无历史上下文的 Claude Session** 对代码库进行冷检查。验证器不感知主 Agent 的执行路径，仅根据目标条件客观判断。若验证失败，主 Agent 获得结构化反馈继续迭代。citeweb_search:2#3
- **成本护栏**：支持 `maxCostPerSession` / `maxCostPerTask` 配置，在消费异常时主动警告。citeweb_search:2#11
- **轻量级完成检查模型**：验证器使用更轻量的模型降低成本，主 Agent 使用推理模型执行。citeweb_search:2#7

### 2.2 OpenAI Codex CLI `/goal` (2026-04-30, v0.128.0)

OpenAI 的实现称为 **"Ralph loop"**，核心依赖两个提示文件：
- `goals/continuation.md` — 每轮注入，指导下一步行动
- `goals/budget_limit.md` — 预算耗尽时触发总结

与你的系统对比：**Codex 的实现更轻量，但缺少你的 DAG 子任务、Episodic Memory、Skill Library 等企业级特性**。citeweb_search:1#16

### 2.3 学术前沿：W&D 并行工具调用 (Salesforce AI, 2026-02)

**Wide & Deep (W&D)** 框架证明：
- 每轮并行调用 **3 个工具** 是最优平衡点
- 可减少 **~60% 的轮次** 和 **~40% 的 API 成本**
- **Descending 调度策略**：前期广撒网并行探索，后期聚焦顺序执行

你的文档明确提到 **"No true parallel execution"** 是已知限制，这是最大的低 hanging fruit。citeweb_search:2#0citeweb_search:2#8

### 2.4 技能库进化：PANDO (2026-05)

PANDO 指出 Voyager 技能库的 **"monotone-growth weakness"**（单调增长弱点）：
- 技能只增不减，导致检索噪声上升
- 解决方案：**Demotion Blacklist**（降级黑名单）+ 结构化关键词检索替代向量相似度

你的 Skill Library 当前按 `successCount` 排序，但无淘汰机制。citeweb_search:1#5

### 2.5 记忆压缩：AGORA (2026-05)

AGORA 提出**无需 LLM 推理的 Prompt 压缩**：
- 通过适配器判断 "移除某历史步骤是否改变下一步动作"
- 避免 MemGPT/ACON 等方案每步调用 LLM 压缩的高额 token 成本

你的 Episodic Memory 在 20 条上限后简单淘汰最旧条目，未做语义压缩。citeweb_search:2#13

---

## 三、高优先级优化建议

### 3.1 🔴 P0：引入独立验证器 (Critic/Validator)

**问题**：当前 `[GOAL_COMPLETED]` 文本标记容易被模型误触发或嵌入工具参数中漏检，导致**假阳性完成**。

**方案**：
```typescript
// 新增 goalValidator.ts
interface ValidatorConfig {
  enabled: boolean
  model?: string        // 可使用轻量模型如 'claude-sonnet-4-6' 降低成本
  maxTokens: number
  temperature: 0.0     // 严格模式
}

// 验证器 Prompt 设计原则：
// 1. 不注入主 Agent 的执行历史（冷启动）
// 2. 仅提供：原始 objective + 当前代码库状态 + 需要验证的 condition
// 3. 输出结构化 JSON：{ "passed": boolean, "missing": string[], "severity": "critical" | "warning" }
```

**实现点**：
- 在 `goalState.ts` 中新增 `validatorSession` 字段
- 在 `query.ts` 的完成检测逻辑中，先触发验证器，再确认完成
- 验证失败时，将 `missing` 列表注入主 Agent 的 Continuation Prompt 作为修正指令

### 3.2 🔴 P0：原生并行工具执行框架

**问题**：文档明确承认 "Subtask parallelism is advisory only; the model must execute tasks in parallel using multiple tool calls"。模型不一定能自主做到最优并行。

**方案**：在 `goalState.ts` 的 DAG 子任务层之上，增加 **Execution Scheduler**：

```typescript
// 新增 goalScheduler.ts
interface ExecutionBatch {
  id: string
  tasks: Subtask[]
  strategy: 'parallel' | 'sequential'
  // W&D Descending 策略：前期 width=3，后期 width=1
  maxParallelism: number
}

function scheduleBatches(dag: Subtask[]): ExecutionBatch[] {
  // 1. 拓扑排序获取依赖层级
  // 2. 同层级任务标记为 parallel
  // 3. 根据当前 turn 数动态调整 maxParallelism（前期高，后期低）
}
```

**关键改动**：
- `getReadySubtasks()` 返回的任务列表需经 Scheduler 分组成 `ExecutionBatch`
- Continuation Prompt 中注入 `parallelHint` 时，明确告知模型："以下 N 个任务无依赖，请在一次响应中并行调用工具"
- 在 `query.ts` 中支持单次 LLM 响应中的多工具调用并发执行（利用底层模型的 `parallel_tool_calls` 能力）

### 3.3 🔴 P0：自动工具链验证 (Auto-Verification) ✅ 已实现

**问题**：Condition Mode 依赖模型判断 "tests pass"，但模型可能误判测试输出。

**方案**：借鉴 Claude Code 2.1 的 `autoVerify` 机制：

```typescript
// 在 goalState.ts 中已实现
interface VerificationConfig {
  commands: string[]    // 如 ["npm test", "tsc --noEmit"]
  maxRetries: number
  timeoutMs: number
}

interface VerificationResult {
  passed: boolean
  command: string
  exitCode: number
  stdout: string
  stderr: string
  timestamp: number
}

// 已实现函数：
// - setGoalVerification(config): 设置验证命令
// - recordVerificationResult(result): 记录验证结果
// - isVerificationPassed(): 检查所有验证是否通过
// - getVerificationStatus(): 获取验证状态摘要
// - getGoalVerification(): 获取验证配置
```

**验证流程**：
1. 模型声明完成后，系统自动执行 `verification.commands`
2. 收集 exit code + stdout/stderr
3. 仅当所有命令 exit(0) 时，才触发 `[GOAL_COMPLETED]`
4. 失败时，将 stderr 注入 Continuation Prompt 作为错误上下文

**集成点**：
- `goalPrompts.ts` 的 `buildGoalContinuationPrompt` 中展示验证状态
- `buildGoalEvaluatorPrompt` 中集成验证命令感知

### 3.4 🟡 P1：Token 成本护栏 ✅ 已实现

**问题**：仅控制 `maxTurns` 无法防止单轮生成超长回复导致的高额费用。

**方案**：
```typescript
// 在 goalState.ts 中已实现
interface BudgetConfig {
  maxTokensTotal?: number      // 累计 token 上限
  maxTokensPerTurn?: number    // 单轮上限
  maxCostUSD?: number          // 基于模型定价的估算成本上限
  warningThresholds: {
    tokens: number[]           // token 使用百分比告警阈值
    cost: number[]             // 成本百分比告警阈值
  }
}

// 已实现函数：
// - setBudgetConfig(config): 设置预算配置
// - getBudgetConfig(): 获取预算配置
// - checkBudgetWarning(): 检查是否超过告警阈值，返回警告信息
// - getBudgetStatus(): 获取格式化的预算状态字符串
```

**集成点**：
- `goalPrompts.ts` 的 `buildGoalContinuationPrompt` 中展示预算状态和警告
- 基于现有 `tokensSpent` 字段进行实时百分比计算

### 3.5 🟡 P1：技能库淘汰机制 (Skill Demotion) ✅ 已实现

**问题**：Skill Library 30 条上限满后，仅按 `lastUsedTurn` 淘汰，未考虑技能实际有效性衰减。

**方案**：引入 PANDO 的 **Demotion Blacklist** + 成功率衰减窗口：

```typescript
// 在 goalState.ts 中已实现
interface SkillEntry {
  // ... existing fields
  successWindow: boolean[]  // 最近 10 次使用记录
  deprecated: boolean
  deprecatedReason?: string
}

// 已实现函数：
// - recordSkillOutcome(skillName, success): 记录技能使用结果
// - isSkillDeprecated(skillName): 检查技能是否已被淘汰
// - getDeprecatedSkills(): 获取已淘汰技能列表及原因
```

**淘汰规则**（已实现）：
1. 连续 3 次失败 → 标记 deprecated
2. 最近 10 次成功率 < 50% → 标记 deprecated
3. 已淘汰技能自动从 `getRelevantSkills()` 结果中过滤
4. 技能库满时优先淘汰 deprecated 技能

### 3.6 🟡 P1：记忆上下文压缩 (AGORA-lite) ✅ 已实现

**问题**：Episodic Memory 满 20 条后简单淘汰旧条目，可能导致关键早期失败经验丢失。

**方案**：轻量级压缩策略（无需额外 LLM 调用）：

```typescript
// 在 goalState.ts 中已实现
interface EpisodicMemoryEntry {
  // ... existing
  importanceScore: number   // 基于 error severity + retryCount 计算（1-10）
}

// 已实现的智能淘汰逻辑：
// - calculateImportanceScore(): 根据 outcome、error、retryCount 计算重要性
// - recordEpisode(): 满 20 条时，淘汰 importanceScore 最低的条目（而非最旧的）
```

**重要性评分规则**（已实现）：
1. 基线分数：5
2. failure → +3，partial → +1
3. 有详细错误信息 → +1
4. retryCount >= 3 → +1
5. 范围限制在 1-10

**效果**：关键失败经验（多次重试、严重错误）会被优先保留，单次偶发错误优先淘汰

### 3.7 🟢 P2：多 Agent 编排（Supervisor-Worker 轻量版）

**问题**：单 Agent 架构下，复杂目标（如 "重构整个模块并确保所有测试通过"）的验证和 execution 耦合，容易陷入自我确认偏差。

**方案**：引入轻量级 **Dual-Agent 模式**（非完整多 Agent 系统）：

```typescript
// 仅扩展 Goal 类型
type GoalMode = 'objective' | 'condition' | 'dual-agent'

interface DualAgentConfig {
  executorModel: string      // 主执行 Agent（高推理能力）
  criticModel: string        // 验证 Agent（轻量模型，严格模式）
  maxDebateRounds: number    // 执行与验证的最大辩论轮次
}

// 流程：
// 1. Executor 完成一轮修改
// 2. Critic 独立验证并给出反馈
// 3. 若 Executor 与 Critic 意见分歧，进入 Debate 模式（最多 N 轮）
// 4. 分歧无法解决时，升级至 Human-in-the-loop
```

---

## 四、实现路线图

### Phase 1：核心可靠性（2-3 周）
1. **Auto-Verification**：在 Condition Mode 中集成项目命令验证
2. **独立验证器**：新增 `goalValidator.ts`，实现冷启动验证流程
3. **并行调度器**：实现 `goalScheduler.ts`，支持同层级 DAG 任务的原生并行执行

### Phase 2：成本与效率优化（1-2 周）
4. **Token 成本护栏**：扩展 BudgetConfig，接入 tiktoken 成本估算
5. **W&D Descending 策略**：在 Scheduler 中实现动态并行度调整（前期 3-call，后期 1-call）

### Phase 3：智能进化（2-3 周）
6. **技能淘汰机制**：Skill Library 增加成功率衰减窗口和 Demotion Blacklist
7. **记忆压缩**：Episodic Memory 增加重要性评分和合并压缩逻辑
8. **Dual-Agent 模式**：可选的 Executor-Critic 分离架构

---

## 五、关键设计决策建议

1. **验证器模型选择**：不必使用与主 Agent 同等级模型。轻量模型（如 Claude Sonnet 4.6 或 GPT-4o-mini）在严格温度(0)下足以完成 pass/fail 判断，可**降低 60-70% 验证成本**。citeweb_search:2#3

2. **并行执行安全边界**：原生并行工具调用时，必须确保：
   - 同批次任务无共享状态变更（读操作可并行，写操作需顺序化）
   - 在 `ExecutionBatch` 中标记 `hasSideEffects: boolean`，有副作用的任务自动降级为顺序执行

3. **完成检测双保险**：保留 `[GOAL_COMPLETED]` 标记作为**第一层信号**，但必须以**验证器通过 + 工具链 exit(0)** 作为**最终确认**。两层都通过才算真正完成。

4. **持久化兼容性**：所有新增字段（`verification`, `budget`, `validatorResult`）需兼容现有 `~/.claude/goal-persistence/goal_persistence.json` 格式，支持向后兼容加载。

---

## 六、参考资源

| 项目/论文 | 核心启示 | 链接 |
|----------|---------|------|
| Claude Code /goal 官方 | 独立验证器 + 成本护栏 | articleweb_search:2#3web_search:2#7web_search:2#11 |
| OpenAI Codex CLI /goal | 轻量 Ralph loop 实现 | articleweb_search:1#16 |
| W&D Parallel Tool Calling | 并行调度降本增效 | articleweb_search:2#0web_search:2#8 |
| PANDO | 技能库在线蒸馏与淘汰 | articleweb_search:1#5 |
| AGORA | 无推理记忆压缩 | articleweb_search:2#13 |
| M1-Parallel | 多计划并行执行 | articleweb_search:2#2 |
| Multi-Agent Orchestration 2026 | 编排模式选型指南 | articleweb_search:2#4web_search:2#5web_search:2#12 |
