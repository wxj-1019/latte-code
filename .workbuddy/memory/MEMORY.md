# latte-code 项目记忆

## 架构约定
- Bun >= 1.3.11 运行时，TypeScript strict:false
- Feature Flag 通过 bun:bundle 编译期 DCE
- 模式：feature('FLAG_NAME') ? require(...) : null
- 工具注册：src/tools.ts → buildTool()
- 命令注册：src/commands.ts → Command type

## 动态工作流引擎
- 位置：src/services/workflow/
- 沙箱：Bun vm 模块（零依赖，白名单 API）
- 代理池：复用 src/tools/shared/spawnMultiAgent.ts
- 与 Nudge Engine 形成 Learn→Execute→Improve 闭环
- 触发模型：自动(Nudge) + 关键词 + /workflow 命令
- Feature flag：WORKFLOW_SCRIPTS

## 关键子系统路径
- 子代理：src/tools/AgentTool/ → spawnMultiAgent
- Nudge：src/services/nudgeEngine/
- 记忆：src/memdir/ + src/services/extractMemories/
- 压缩：src/services/compact/ (5层管线)
- MCP：src/services/mcp/ (23文件)
- 权限：src/utils/permissions/ (24文件/9425行)
- Smart Approvals：src/utils/permissions/smartApproval.ts (三分类审批引擎)

## 当前版本
v2.1.95-dev
