# AGENTS.md

This file provides essential context for AI coding agents working with the latte project.

## Project Overview

**latte** is a buildable fork of Anthropic's Claude Code CLI - a terminal-native AI coding agent. This fork has three key differences from the upstream:

1. **Telemetry removed** - All outbound analytics, crash reporting, and session fingerprinting stripped
2. **Security-prompt guardrails removed** - No hardcoded refusal patterns or server-pushed security overlays
3. **Experimental features unlocked** - 54 feature flags enabled that are disabled in the public release

- **Version**: 2.1.87
- **Repository**: https://github.com/wxj-1019/latte-code
- **Package Manager**: Bun >= 1.3.11 (required)
- **Runtime**: Bun
- **Language**: TypeScript

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) >= 1.3.11 |
| Language | TypeScript (ESNext, JSX) |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI Parsing | Commander.js |
| Schema Validation | Zod v4 |
| HTTP Client | Built-in Bun fetch / axios |
| State Management | Custom store (Zustand-like) |

## Build Commands

All builds are handled by `scripts/build.ts` with feature flag support:

```bash
# Install dependencies
bun install

# Standard production build → ./cli
bun run build

# Development build (with dev version stamp) → ./cli-dev
bun run build:dev

# Full experimental build (54 feature flags) → ./cli-dev
bun run build:dev:full

# Compile to dist directory → ./dist/cli
bun run compile

# Run from source without building (slower startup)
bun run dev

# Custom feature flags
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=BRIDGE_MODE
```

### Build System Details

- Uses `bun:bundle` with compile-time feature flags for dead code elimination
- Feature flags are passed via `--feature=FLAGNAME` to the build command
- Default enabled feature: `VOICE_MODE`
- Full experimental feature set includes: `BRIDGE_MODE`, `ULTRAPLAN`, `ULTRATHINK`, `AGENT_TRIGGERS`, `BASH_CLASSIFIER`, etc.

## Project Structure

```
latte/
├── scripts/
│   └── build.ts              # Build script with feature flag injection
├── src/
│   ├── entrypoints/          # CLI entry points
│   │   ├── cli.tsx           # Main entry (fast paths, flag routing)
│   │   ├── init.ts           # Subsystem initialization
│   │   └── mcp.ts            # MCP server entry
│   ├── screens/
│   │   └── REPL.tsx          # Main interactive UI (Ink/React)
│   ├── commands/             # Slash command implementations (/help, /model, etc.)
│   ├── tools/                # Tool implementations (Bash, Read, Edit, etc.)
│   ├── components/           # Ink/React terminal UI components
│   ├── hooks/                # React hooks
│   ├── services/             # External service integrations
│   │   ├── api/              # API clients (Anthropic, Codex, Bedrock, Vertex)
│   │   ├── mcp/              # MCP client implementation
│   │   ├── oauth/            # OAuth 2.0 PKCE flows
│   │   └── lsp/              # Language Server Protocol
│   ├── state/                # Global state management (AppState)
│   ├── utils/                # Utility functions
│   │   ├── model/            # Model configs and provider routing
│   │   ├── permissions/      # Permission system
│   │   └── ...
│   ├── skills/               # Skill system (bundled + dynamic)
│   ├── plugins/              # Plugin system
│   ├── bridge/               # IDE remote control bridge
│   ├── voice/                # Voice input system
│   ├── tasks/                # Background task management
│   ├── ink/                  # Fork of Ink terminal renderer
│   ├── QueryEngine.ts        # Core LLM query engine
│   ├── commands.ts           # Command registry
│   ├── tools.ts              # Tool registry
│   ├── main.tsx              # Commander CLI setup
│   └── query.ts              # LLM query loop
├── package.json
├── tsconfig.json
└── install.sh                # One-line installer script
```

## Boot Sequence

```
cli.tsx (entry)
    │
    ├── Fast paths (--version, --dump-system-prompt, etc.)
    │
    └── Normal flow
        │
        ▼
    init.ts (enableConfigs, OAuth, mTLS, CA certs, LSP, Scratchpad)
        │
        ▼
    main.tsx (Commander.js setup, GrowthBook init, auth checks)
        │
        ▼
    replLauncher.tsx (Ink TUI bootstrap)
        │
        ▼
    REPL.tsx (Main interactive interface)
```

## Query Pipeline (Core Data Flow)

The heart of the system - how user input becomes AI responses:

```
User Input
    │
    ▼
QueryEngine.submitMessage()
    │
    ├── 1. Build System Prompt
    │   ├── fetchSystemPromptParts()
    │   ├── Load Memory / CLAUDE.md
    │   └── Inject Skill / Plugin context
    │
    ├── 2. processUserInput()
    │   ├── Parse slash commands (/model, etc.)
    │   ├── Handle file attachments
    │   └── Build UserMessage
    │
    ├── 3. query() loop (src/query.ts)
    │   ├── Call Claude API (streaming)
    │   ├── Parse tool_use blocks
    │   ├── Permission check (canUseTool)
    │   ├── Execute Tool
    │   ├── Append result to messages
    │   └── Loop until stop_reason
    │
    ├── 4. Auto Compact (context compression)
    │
    └── 5. Yield SDKMessage to caller
```

## Supported Model Providers

| Provider | Environment Variable | Auth Method |
|----------|---------------------|-------------|
| Anthropic (default) | - | `ANTHROPIC_API_KEY` or OAuth |
| OpenAI Codex | `CLAUDE_CODE_USE_OPENAI=1` | OAuth via OpenAI |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | AWS credentials |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` | `gcloud auth application-default login` |
| Anthropic Foundry | `CLAUDE_CODE_USE_FOUNDRY=1` | `ANTHROPIC_FOUNDRY_API_KEY` |

### Key Environment Variables

```bash
# API Keys
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_AUTH_TOKEN="..."
ANTHROPIC_FOUNDRY_API_KEY="..."

# Provider Selection
CLAUDE_CODE_USE_OPENAI=1
CLAUDE_CODE_USE_BEDROCK=1
CLAUDE_CODE_USE_VERTEX=1
CLAUDE_CODE_USE_FOUNDRY=1

# Model Overrides
ANTHROPIC_MODEL="claude-opus-4-6"
ANTHROPIC_DEFAULT_OPUS_MODEL="..."
ANTHROPIC_DEFAULT_SONNET_MODEL="..."
ANTHROPIC_DEFAULT_HAIKU_MODEL="..."

# Simple Mode (Bash/Read/Edit only)
CLAUDE_CODE_SIMPLE=1

# AWS Bedrock
AWS_REGION="us-east-1"
ANTHROPIC_BEDROCK_BASE_URL="..."
```

## Tool System

All tools implement the `Tool` interface (see `src/Tool.ts`). Tools are registered in `src/tools.ts` via `getAllBaseTools()`.

### Core Tools

| Tool | Purpose |
|------|---------|
| BashTool | Shell command execution with timeout support |
| PowerShellTool | Windows PowerShell execution |
| FileReadTool | File reading with caching |
| FileEditTool | SEARCH/REPLACE based file editing |
| FileWriteTool | File creation/overwriting |
| GlobTool | File pattern matching |
| GrepTool | Content regex search |
| WebFetchTool | Web page fetching |
| WebSearchTool | Web search |
| AgentTool | Sub-agent delegation |
| SkillTool | Skill system invocation |
| MCPTool | MCP Server tool calls |
| LSPTool | Language Server Protocol |
| TodoWriteTool | Task list management |
| AskUserQuestionTool | Interactive user prompts |
| Task*Tool | Background task CRUD |
| BriefTool | Context summarization |

### Tool Features

- **Feature Flag gating**: Some tools only register when specific features are enabled
- **Permission filtering**: `filterToolsByDenyRules()` applies user permission rules
- **MCP merging**: `assembleToolPool()` combines built-in and MCP tools
- **Deferred loading**: Tools can be marked for deferred loading via ToolSearch

## Command System

Commands implement the `Command` interface (see `src/commands.ts`). Three types:

| Type | Description | Examples |
|------|-------------|----------|
| `local` | Pure function, returns text | /cost, /clear, /compact |
| `local-jsx` | Renders Ink UI component | /model, /theme, /help |
| `prompt` | Expands to prompt text for model | /commit, /review |

### Command Sources (in priority order)

1. Built-in commands (`COMMANDS()`)
2. Bundled Skills (`bundledSkills`)
3. Skill directory (`.claude/skills/`)
4. Plugin Skills (`pluginSkills`)
5. Workflow commands (`workflowCommands`)
6. MCP Skills (`mcpSkillCommands`)
7. Dynamic Skills (`dynamicSkills`)

## Key Design Patterns

### Feature Flag System

Compile-time dead code elimination via `bun:bundle`:

```typescript
import { feature } from 'bun:bundle';

if (feature('BRIDGE_MODE')) {
  // This entire block is removed if BRIDGE_MODE not in feature set
}
```

### Lazy Loading

Fast paths use dynamic imports to avoid loading heavy modules:

```typescript
// Fast path for --version requires zero imports
if (args[0] === '--version') {
  console.log(MACRO.VERSION);
  return;
}

// Heavy imports loaded only when needed
const { main: cliMain } = await import('../main.js');
```

### Async Generator Pattern

Query pipeline uses `AsyncGenerator<SDKMessage>` for streaming:

```typescript
for await (const message of QueryEngine.submitMessage(input)) {
  // Update UI in real-time
}
```

## Code Style Guidelines

- **Imports**: Use `.js` extensions for all imports (TypeScript with `allowImportingTsExtensions`)
- **Types**: Strict mode is OFF (`"strict": false` in tsconfig)
- **Linting**: Uses Biome (not ESLint) - look for `// biome-ignore` comments
- **Top-level side effects**: Marked with `// eslint-disable-next-line custom-rules/no-top-level-side-effects`
- **Feature gating**: Use `feature('FLAG_NAME')` for compile-time conditional code
- **Circular dependencies**: Use lazy `require()` for breaking cycles

### Import Conventions

```typescript
// Standard import
import { something } from './utils/something.js';

// Type import
import type { SomeType } from './types.js';

// Lazy import (for circular dependency breaking)
const lazyModule = condition ? require('./module.js').exported : null;
```

## Testing

**No test suite is present** in this codebase. Testing is done manually via:

1. Running the built CLI: `./cli` or `./cli-dev`
2. Testing specific features via environment flags
3. Using the `/doctor` command for diagnostics

## Security Considerations

### Permission System

```typescript
ToolPermissionContext
├── mode: 'default' | 'plan' | 'bypassPermissions'
├── alwaysAllowRules: ToolPermissionRulesBySource
├── denyRules: ToolPermissionRulesBySource
└── additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
```

### Policy Limits

Organizations can enforce restrictions via:
- `src/services/policyLimits/` - Policy enforcement
- Remote managed settings - Server-pushed configuration
- MDM (Mobile Device Management) - macOS enterprise controls

### Safe Defaults

- Tools default to `isConcurrencySafe: false`
- Tools default to `isReadOnly: false` (assume writes)
- Tools default to `isDestructive: false`
- Permission check defaults to `{ behavior: 'allow' }` but tools should implement specific checks

## Common Development Tasks

### Adding a New Tool

1. Create directory in `src/tools/ToolNameTool/`
2. Implement tool following the `Tool` interface
3. Export from `src/tools/ToolNameTool/ToolNameTool.ts`
4. Register in `src/tools.ts` via `getAllBaseTools()`
5. Add feature flag gating if experimental

### Adding a New Command

1. Create directory in `src/commands/command-name/`
2. Implement command following the `Command` interface
3. Export from `src/commands/command-name/index.ts`
4. Import and register in `src/commands.ts`

### Adding a Feature Flag

1. Add to `scripts/build.ts` in `fullExperimentalFeatures` array if experimental
2. Add to `defaultFeatures` if always enabled
3. Use `feature('FLAG_NAME')` for conditional code

## Debugging

Enable debug output via environment:

```bash
# Verbose logging
DEBUG=1 ./cli

# Specific module debugging
DEBUG=claude-ai-sdk ./cli

# Startup profiling (built-in)
CLAUDE_CODE_PROFILE=1 ./cli
```

## External Dependencies

Key external packages:

- `@anthropic-ai/sdk` - Anthropic API client
- `@anthropic-ai/bedrock-sdk` - AWS Bedrock integration
- `@anthropic-ai/vertex-sdk` - Google Vertex integration
- `@modelcontextprotocol/sdk` - MCP protocol
- `ink` - Terminal UI (custom fork in `src/ink/`)
- `react` / `react-reconciler` - UI framework
- `commander` - CLI argument parsing
- `zod` - Schema validation
- `chalk` - Terminal colors
- `execa` - Process execution
- `diff` - Text diffing for edits

## Resources

- **Upstream**: Claude Code by Anthropic (https://docs.anthropic.com/en/docs/claude-code)
- **Bun docs**: https://bun.sh/docs
- **Ink docs**: https://github.com/vadimdemedes/ink
- **MCP spec**: https://modelcontextprotocol.io
