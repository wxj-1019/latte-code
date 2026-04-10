**custom-openai-provider-plan**

围绕当前仓库真实结构，制定首期 OpenAI-compatible 自定义模型改造计划：新增 \`/add-model\` 配置入口，兼容环境变量与交互式配置，并通过 API 边界适配保持内部 Anthropic 消息格式不变。

## **User Requirements**

- 基于 `custom-model-guide.md` 制定一份可按步骤推进的改造计划。
- 首期只做 OpenAI 兼容接入，目标场景包括 DeepSeek、Ollama、OpenRouter。
- 新增独立 `/add-model` 命令，不能只依赖现有 `/model`。
- 同时规划两种配置方式：环境变量直连、终端交互式配置。
- 改造应尽量复用现有模型选择、校验、状态展示与命令链路，避免大范围改动内部消息处理。

## **Product Overview**

在现有终端模型体系中增加“自定义兼容模型接入”能力。用户可以通过命令或交互式向导录入接口地址、模型名与密钥，并把新增模型纳入后续选择与使用流程。终端视觉效果以分步输入、确认提示、状态回显为主，保持当前命令行交互风格一致。

## **Core Features**

- OpenAI 兼容模型接入与统一调用入口
- `/add-model` 分步添加、保存、激活自定义模型
- 环境变量覆盖与交互式配置共存
- 自定义模型进入模型列表并支持选择
- 模型校验、状态展示与错误提示联动

## **Tech Stack Selection**

- 运行时与主代码：当前仓库的 Bun + TypeScript
- 终端交互界面：现有 React + Ink 组件体系
- 模型调用边界：现有 `@anthropic-ai/sdk` + fetch adapter 模式
- 配置与存储：现有 `GlobalConfig`、settings 基础设施、SecureStorage

## **Implementation Approach**

### **总体策略**

复用当前“内部保持 Anthropic Messages 结构、边界做协议转换”的模式，不重写 `src/services/api/claude.ts` 的主查询逻辑，而是在 `src/services/api/client.ts` 这一层接入新的 OpenAI-compatible fetch adapter。这样可以最大化复用现有消息组装、工具调用、流式处理、重试与成本统计链路。

### **关键决策**

- **优先复用现有 openai provider 分支**：保留 `APIProvider = 'openai'`，再增加“Codex / 通用 OpenAI-compatible”子模式判断，避免把 provider 枚举改穿全仓库。
- **默认先支持 Chat Completions 兼容面**：DeepSeek、Ollama、OpenRouter 的通用兼容性更高；`responses` 可作为保留字段或次级模式，不作为首期主路径。
- **配置分层**：
- 环境变量：用于快速接入与临时覆盖
- 交互式配置：用于持久化用户自定义模型
- 非敏感信息放配置，敏感密钥走现有安全存储抽象，避免明文落盘
- **模型选择仍沿用现有** **`/model`** **链路**：`/add-model` 负责新增与保存，自定义模型最终仍进入 `modelOptions` 与 `validateModel()` 体系。

### **性能与可靠性**

- 流式协议转换为单次线性遍历，时间复杂度 `O(n)`，额外空间按 chunk 增量处理，避免整流缓冲。
- 模型校验继续复用最小真实请求方式，避免单独维护一套“伪校验”逻辑。
- 主要瓶颈在 SSE/JSON chunk 转换与兼容字段映射，需采用增量解析、少复制、少序列化策略。
- 通过保持 `claude.ts` 基本不动来缩小回归面，重点把风险收敛到 `client.ts`、adapter、配置解析层。

## **Implementation Notes**

- 保留现有 Codex OAuth 路径；当 `openai` provider 激活时，必须先区分“Codex”与“通用兼容 API”。
- 不记录 `apiKey`、`Authorization`、完整请求体；日志仅输出 provider、baseURL 主机、model、模式与错误摘要。
- Anthropic 专有字段如 `thinking`、`cache_control`、部分 beta header 在兼容路径中应显式降级或剔除，避免把不兼容字段透传到第三方接口。
- 对保存的自定义模型名做唯一性约束；若多个端点复用同一模型名，首期应拒绝重复或要求用户重新命名，防止运行时无法反查端点。
- 配置不完整时必须安全回退到现有路径，不能劫持原有 Anthropic / Bedrock / Vertex / Foundry / Codex 行为。

## **Architecture Design**

### **结构关系**

- **命令与交互层**
- `/add-model`
- `ConsoleOAuthFlow.tsx`
- 共享终端配置流程组件
- **配置解析层**
- 自定义模型元数据配置
- 安全存储中的密钥
- 环境变量覆盖解析
- **Provider 决策层**
- `getAPIProvider()`
- OpenAI 子模式判定
- 按模型名反查自定义端点
- **API 边界层**
- `getAnthropicClient()`
- OpenAI-compatible fetch adapter
- **模型联动层**
- `modelOptions`
- `validateModel`
- `status`

### **数据流**

用户通过 `/add-model` 或交互式入口录入配置 → 写入配置与安全存储 → `providers.ts` / 解析工具决定当前模型对应的兼容端点 → `client.ts` 为 Anthropic SDK 注入兼容 adapter → adapter 把请求转换成 OpenAI-compatible 协议并把响应再转换回 Anthropic 风格 → 现有 REPL 与工具链继续照常工作。

## **Directory Structure**

### **Directory Structure Summary**

本次方案尽量不改主查询内核，而是在“配置解析、provider 判定、客户端适配、命令与终端交互”四个层面落地。以下为建议的创建/修改清单。

``c:/Users/Administrator/Desktop/latte-main/ ├── src/ │   ├── services/ │   │   └── api/ │   │       ├── client.ts                                  # [MODIFY] 统一客户端分发入口。新增 Codex 与通用 OpenAI-compatible 的子模式分流；为兼容模型注入 fetch adapter；保持现有 Anthropic/Bedrock/Vertex/Foundry 路径不变。 │   │       ├── openai-compatible-fetch-adapter.ts         # [NEW] 通用 OpenAI-compatible 适配器。负责把 Anthropic Messages 请求转换为 OpenAI-compatible 请求，并把流式/非流式响应回转为 Anthropic 风格；需参考现有 codex-fetch-adapter 的拦截方式。 │   │       └── logging.ts                                 # [MODIFY] API 诊断与埋点补充。输出兼容 provider 的 baseURL/model 摘要，禁止泄露密钥与大 payload。 │   ├── utils/ │   │   ├── config.ts                                      # [MODIFY] 增加自定义模型元数据类型与持久化字段。只保存非敏感配置，如名称、model、baseURL、模式、激活状态等，并保持默认值与旧配置兼容。 │   │   ├── customApiStorage.ts                            # [NEW] 自定义模型安全存储与配置合并工具。负责读写密钥、清理数据、按环境变量与已保存配置计算最终生效的兼容配置。 │   │   ├── auth.ts                                        # [MODIFY] 将通用 OpenAI-compatible 视为外部 provider；必要时新增 `DOGE_API_KEY` 来源识别；保证 Anthropic/Codex/兼容 API 三条鉴权链互不混淆。 │   │   ├── status.tsx                                     # [MODIFY] 状态面板展示兼容 provider、当前 baseURL 与当前模型摘要；区分 Codex 与通用兼容 API。 │   │   └── model/ │   │       ├── providers.ts                              # [MODIFY] 扩展 provider 与 openai 子模式判定；支持环境变量优先级与已保存自定义模型反查；保持现有 provider 返回语义尽量稳定。 │   │       ├── modelOptions.ts                           # [MODIFY] 把已保存的自定义模型追加到模型列表；与 `ANTHROPIC_CUSTOM_MODEL_OPTION`、bootstrap 模型缓存去重合并。 │   │       ├── validateModel.ts                          # [MODIFY] 复用现有 `sideQuery()` 做兼容模型真实校验；补充 provider 感知错误提示、重复模型名与无效端点提示。 │   │       └── model.ts                                  # [MODIFY] 统一自定义模型的展示名称与回显文本，确保 `/model`、命令结果与状态显示一致。 │   ├── components/ │   │   ├── ConsoleOAuthFlow.tsx                          # [MODIFY] 在现有登录/接入选择中增加“自定义 API 接入”入口；与新建共享配置流程复用持久化逻辑。 │   │   └── CustomModelSetupFlow.tsx                      # [NEW] 终端分步配置组件。收集 provider 模式、显示名、baseURL、model、apiKey 等，执行基础校验并保存。 │   └── commands/ │       ├── add-model/ │       │   ├── index.ts                                  # [NEW] `/add-model` 命令元数据与注册入口。定义名称、描述、即时性和 load 方式，遵循现有命令目录模式。 │       │   └── add-model.tsx                             # [NEW] `/add-model` 实现。承载向导流程、保存逻辑、激活提示，并在成功后接入现有模型选择链路。 │       └── ../commands.ts                                # [MODIFY] 内建命令注册表。显式注册 `/add-model`，确保命令可发现、可补全、可加载。``

## **Key Code Structures**

- 建议新增一组“自定义模型资料”类型，至少覆盖：显示名、模型名、baseURL、兼容模式、是否激活。
- 建议把敏感字段与非敏感字段分离存储：密钥走安全存储，元数据走全局配置。
- 建议提供一个统一解析入口，输出“当前模型对应的有效兼容配置”，供 `client.ts`、`status.tsx`、`validateModel.ts` 复用，避免多处重复判定。

## **Agent Extensions**

### **SubAgent**

- **code-explorer**
- Purpose: 在实施过程中复核命令注册、provider 判定、模型选项与鉴权调用链，避免遗漏联动文件。
- Expected outcome: 输出准确的影响面清单，并确认 `/add-model`、`client.ts`、`modelOptions.ts`、`status.tsx` 等落点一致。

### **MCP**

- **context7**
- Purpose: 查询 OpenAI Chat Completions / Responses 的最新流式协议、工具调用字段与兼容约束。
- Expected outcome: 为 `openai-compatible-fetch-adapter.ts` 提供可靠的请求/响应映射依据，降低 DeepSeek、Ollama、OpenRouter 适配偏差。enRouter 适配偏差。

## 任务列表

**+ 新建**

- 1. 使用 \[subagent:code-explorer] 复核命令、鉴权与模型链路影响面
- 2. 扩展 config 与安全存储，建立自定义模型配置解析层
- 3. 参考 \[mcp:context7] 实现 OpenAI-compatible adapter 并接入 client
- 4. 打通 providers、auth、modelOptions、validateModel 与 status
- 5. 新增 /add-model 与共享终端配置流程，接入 ConsoleOAuthFlow
- 6. 回归验证 DeepSeek、Ollama、OpenRouter 与 Anthropic/Codex 路径

