/**
 * Design-MD Atomic Capability Module
 * 
 * An AI-callable, reusable atomic capability module for frontend design tasks.
 * Provides structured access to 66+ brand design systems from awesome-design-md.
 * 
 * Capabilities:
 * - fetch: Retrieve design systems in various formats
 * - search: Discover and search design systems
 * - analyze: Analyze colors, typography, and accessibility
 * - generate: Generate CSS, Tailwind, SCSS, and styled-components code
 * - compare: Compare multiple design systems
 * - extract: Extract and export design elements
 * - advise: Design consultant - review, suggest, plan, and apply design systems
 * 
 * @module design-md
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ToolUseContext } from '../../../Tool.js'
import { registerBundledSkill } from '../../bundledSkills.js'
import { 
  executeCapability, 
  getAllCapabilities,
  searchCapability 
} from './registry'
import type { CapabilityInput } from './types'

export { registerDesignMdSkill }

// Skill configuration
const SKILL_NAME = 'design-md'
const SKILL_DESCRIPTION = `Access 66+ brand design systems from awesome-design-md collection as AI-callable atomic capabilities.

This skill provides structured, programmatic access to design system data for:
- Design system research and analysis
- Frontend code generation (CSS, Tailwind, SCSS)
- Visual design comparison and benchmarking
- Accessibility analysis
- Brand design migration
- Design consultant: review your code and get intelligent recommendations

Available capabilities (English | 中文):
• get/获取 <brand>              - Retrieve design systems
• search/搜索 <query>           - Search by category or keyword  
• list/列表                     - List all available brands
• analyze/分析 <brand>          - Analyze colors, typography, accessibility
• generate/生成 <brand>         - Generate CSS/Tailwind/SCSS code
• compare/对比 <brands>         - Compare multiple design systems
• extract/提取 <brand>          - Export to Figma tokens, CSS variables, etc
• review/审查 <brand>           - Review your code against design system
• suggest/建议 <brand>          - Get contextual design suggestions
• plan/规划 <brand>             - Create complete design plans
• apply/应用 <brand>            - Apply design system to components

Example invocations:
English:  /design-md get apple
中文:      /design-md 获取 apple
English:  /design-md review stripe --file src/pages/Login.tsx
中文:      /design-md 审查 stripe --file src/pages/Login.tsx`

const SKILL_DESCRIPTION_ZH = `访问 awesome-design-md 收藏集中的 66+ 品牌设计系统，作为 AI 可调用的原子能力模块。

此技能为以下场景提供结构化、程序化的设计系统数据访问：
- 设计系统研究与分析
- 前端代码生成（CSS、Tailwind、SCSS）
- 视觉设计对比与基准测试
- 可访问性分析
- 品牌设计迁移
- 设计顾问：审查代码并提供智能设计建议

可用能力（中文 | English）：
• 获取/get <brand>              - 获取完整或部分设计系统
• 搜索/search <query>           - 按类别或关键词查找设计系统
• 列表/list                     - 列出所有可用品牌
• 分析/analyze <brand>          - 分析颜色、排版、可访问性
• 生成/generate <brand>         - 生成 CSS/Tailwind/SCSS 代码
• 对比/compare <brands>         - 对比多个设计系统
• 提取/extract <brand>          - 导出为 Figma tokens、CSS 变量等
• 审查/review <brand>           - 审查代码是否符合设计规范
• 建议/suggest <brand>          - 获取上下文感知的建议
• 规划/plan <brand>             - 创建完整的设计方案
• 应用/apply <brand>            - 将设计系统应用到组件

示例调用：
中文:      /design-md 获取 apple
English:  /design-md get apple
中文:      /design-md 审查 stripe --file src/pages/Login.tsx
English:  /design-md review stripe --file src/pages/Login.tsx`

/**
 * Parse command arguments into capability input
 */
function parseArgs(args: string): { action: string; params: Record<string, string> } {
  const parts = args.trim().split(/\s+/)
  const action = parts[0] || 'list'
  const params: Record<string, string> = {}

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    
    if (part.startsWith('--')) {
      const key = part.slice(2)
      const value = parts[i + 1] && !parts[i + 1].startsWith('--') ? parts[i + 1] : 'true'
      params[key] = value
      if (value !== 'true') i++
    } else if (!params.target) {
      params.target = part
    }
  }

  return { action, params }
}

/**
 * Build capability input from parsed arguments
 */
function buildCapabilityInput(
  action: string, 
  params: Record<string, string>
): CapabilityInput | null {
  switch (action) {
    case 'get':
    case 'fetch':
      return {
        type: 'fetch',
        input: {
          brand: params.target || params.brand || '',
          format: (params.format as any) || 'json',
          theme: (params.theme as any) || 'light',
          section: (params.section as any) || 'all'
        }
      }

    case 'search':
      return {
        type: 'search',
        input: {
          query: params.target || params.query || '',
          category: params.category,
          limit: params.limit ? parseInt(params.limit) : 20
        }
      }

    case 'list':
      return { type: 'list' }

    case 'analyze':
      return {
        type: 'analyze',
        input: {
          brand: params.target || params.brand || '',
          analysisType: (params.type as any) || (params['analysis-type'] as any) || 'full'
        }
      }

    case 'generate':
      return {
        type: 'generate',
        input: {
          brand: params.target || params.brand || '',
          outputType: (params.output as any) || (params.format as any) || 'css',
          options: {
            includeVariables: params['include-vars'] === 'true',
            includeComponents: params['include-components'] === 'true',
            darkMode: params['dark-mode'] === 'true',
            prefix: params.prefix
          }
        }
      }

    case 'compare':
      return {
        type: 'compare',
        input: {
          brands: (params.target || params.brands || '').split(',').map(s => s.trim()).filter(Boolean),
          compareBy: (params['compare-by']?.split(',') as any) || ['colors', 'typography']
        }
      }

    case 'extract':
      return {
        type: 'extract',
        input: {
          brand: params.target || params.brand || '',
          extractType: (params.type as any) || 'full',
          format: (params.format as any) || 'json'
        }
      }

    case 'review':
      return {
        type: 'advise',
        input: {
          action: 'review',
          data: {
            brand: params.target || params.brand || '',
            filePath: params.file,
            code: params.code,
            componentName: params.component
          }
        }
      }

    case 'suggest':
      return {
        type: 'advise',
        input: {
          action: 'suggest',
          data: {
            brand: params.target || params.brand || '',
            context: params.context || params['for'] || '',
            currentCode: params.code,
            goals: params.goals?.split(',') || []
          }
        }
      }

    case 'plan':
    case 'design-plan':
      return {
        type: 'advise',
        input: {
          action: 'plan',
          data: {
            brand: params.target || params.brand || '',
            pageType: (params['page-type'] as any) || 'custom',
            description: params.description || params.desc || '',
            sections: params.sections?.split(',') || [],
            requirements: params.requirements?.split(',') || []
          }
        }
      }

    case 'apply':
      return {
        type: 'advise',
        input: {
          action: 'apply',
          data: {
            brand: params.target || params.brand || '',
            componentType: params.component || params.type || 'button',
            currentCode: params.code,
            variants: params.variants?.split(',') || ['primary', 'secondary']
          }
        }
      }

    default:
      return null
  }
}

/**
 * Generate help message with English commands and Chinese translations
 */
function generateHelpMessage(action: string): string {
  return `Unknown action: ${action}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Available Commands | 可用命令
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Basic Commands | 基础命令:
  get <brand>          - Fetch a design system | 获取设计系统
  search <query>       - Search design systems | 搜索设计系统
  list                 - List all available brands | 列出所有品牌
  analyze <brand>      - Analyze design system | 分析设计系统
  generate <brand>     - Generate code | 生成代码
  compare <brands>     - Compare design systems | 对比设计系统
  extract <brand>      - Extract design elements | 提取设计元素

Design Consultant | 设计顾问:
  review <brand>       - Review design compliance | 审查设计合规性
  suggest <brand>      - Get design suggestions | 获取设计建议
  plan <brand>         - Create design plan | 创建设计方案
  apply <brand>        - Apply design to component | 应用设计系统

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 Common Options | 常用选项
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --format <format>    - Output format | 输出格式: json|markdown|html
  --type <type>        - Analysis type | 类型: colors|typography|accessibility|full
  --output <output>    - Output type | 输出: css|tailwind|scss|styled-components
  --file <path>        - File path | 文件路径
  --context <desc>     - Context description | 上下文描述
  --page-type <type>   - Page type | 页面类型: landing|dashboard|form|list|detail
  --component <type>   - Component type | 组件类型: button|card|input|modal
  --variants <list>    - Variants list | 变体列表 (comma-separated)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Examples | 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /design-md get apple
  /design-md search fintech
  /design-md analyze stripe --type colors
  /design-md generate linear --output tailwind
  /design-md review stripe --file src/pages/Login.tsx
  /design-md suggest linear --context "create a dashboard sidebar"
  /design-md plan stripe --page-type dashboard --description "Payment dashboard"
  /design-md apply stripe --component button --variants primary,secondary`
}

/**
 * Generate prompt for the AI based on capability result
 */
async function generatePrompt(
  args: string,
  context: ToolUseContext
): Promise<ContentBlockParam[]> {
  const { action, params } = parseArgs(args)
  
  // Build capability input
  const capabilityInput = buildCapabilityInput(action, params)
  
  if (!capabilityInput) {
    return [{
      type: 'text',
      text: generateHelpMessage(action)
    }]
  }

  try {
    // Execute the capability
    const result = await executeCapability(capabilityInput)

    // Format result for AI consumption
    const resultText = JSON.stringify(result, null, 2)
    
    return [{
      type: 'text',
      text: `Design-MD Capability Execution Result

Action: ${action}
Parameters: ${JSON.stringify(params)}

Result:
\`\`\`json
${resultText}
\`\`\`

You can use this data to:
1. Answer user questions about the design system
2. Generate code samples
3. Provide design recommendations
4. Compare with other systems

The result includes structured data that you can reference in your response.`
    }]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [{
      type: 'text',
      text: `Error executing design-md capability: ${message}

Please check your arguments and try again.`
    }]
  }
}

/**
 * Register the design-md bundled skill
 */
function registerDesignMdSkill(): void {
  registerBundledSkill({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    descriptionZh: SKILL_DESCRIPTION_ZH,
    argumentHint: '<action> [target] [--option value]',
    userInvocable: true,
    getPromptForCommand: generatePrompt,
    // Include reference files for the skill
    files: {
      'README.md': generateReadme(),
      'capabilities.md': generateCapabilitiesDoc(),
      'examples.md': generateExamplesDoc()
    }
  })
}

// Documentation generators
function generateReadme(): string {
  return `# Design-MD Atomic Capability Module

An AI-callable, reusable atomic capability module for frontend design tasks.

## Overview

Design-MD provides structured access to 66+ brand design systems from the awesome-design-md collection. It's designed as a set of atomic capabilities that can be composed for complex design tasks.

## Quick Start

\`\`\`
/design-md get apple
/design-md search fintech
/design-md analyze stripe --type colors
/design-md generate google-material --output tailwind
\`\`\`

## Capabilities

### Fetch
Retrieve design systems in various formats (JSON, Markdown, HTML).

### Search
Discover design systems by category or keyword.

### Analyze
Analyze colors, typography, and accessibility.

### Generate
Generate CSS, Tailwind, SCSS, and styled-components code.

### Compare
Compare multiple design systems side-by-side.

### Extract
Extract and export design elements to various formats.

### Advise (Design Consultant)
Review your designs and get intelligent recommendations.

**Actions:**
- \`review <brand> --file <path>\` - Review design compliance
- \`suggest <brand> --context <desc>\` - Get contextual suggestions
- \`plan <brand> --page-type <type>\` - Create complete design plan
- \`apply <brand> --component <type>\` - Apply design to component

## Architecture

This skill is built as an atomic capability module:
- Each capability is self-contained and testable
- Capabilities can be composed for complex workflows
- Type-safe interfaces ensure reliability
- Results are structured for AI consumption
`
}

function generateCapabilitiesDoc(): string {
  return `# Capabilities Reference

## fetch

Retrieve design systems from the awesome-design-md collection.

**Actions:**
- \`get <brand>\` - Fetch complete design system
- \`get <brand> --section colors\` - Fetch only colors
- \`get <brand> --format markdown\` - Fetch as markdown

**Parameters:**
- \`brand\`: Brand name (e.g., apple, stripe, linear)
- \`format\`: json | markdown | html (default: json)
- \`theme\`: light | dark (default: light)
- \`section\`: all | colors | typography | components | layout

## search

Search and discover design systems.

**Actions:**
- \`search <query>\` - Search by keyword
- \`search <query> --category fintech\` - Search within category
- \`list\` - List all available brands

**Parameters:**
- \`query\`: Search keyword
- \`category\`: Filter by category ID
- \`limit\`: Maximum results (default: 20)

## analyze

Analyze design systems for various attributes.

**Actions:**
- \`analyze <brand> --type colors\` - Analyze color palette
- \`analyze <brand> --type typography\` - Analyze typography
- \`analyze <brand> --type accessibility\` - Check accessibility
- \`analyze <brand> --type full\` - Complete analysis

## generate

Generate frontend code from design systems.

**Actions:**
- \`generate <brand> --output css\` - Generate CSS variables
- \`generate <brand> --output tailwind\` - Generate Tailwind config
- \`generate <brand> --output scss\` - Generate SCSS

**Options:**
- \`--include-components\`: Include component utilities
- \`--dark-mode\`: Include dark mode variants
- \`--prefix\`: CSS variable prefix

## compare

Compare multiple design systems.

**Actions:**
- \`compare <brand1,brand2>\` - Compare two systems
- \`compare <brand1,brand2,brand3> --compare-by colors,typography\`

## extract

Extract and export design elements.

**Actions:**
- \`extract <brand> --type colors\` - Extract colors
- \`extract <brand> --type full --format figma-tokens\` - Export to Figma

## advise

Design consultant for reviewing and improving your designs.

**Actions:**
- \`review <brand> --file <path>\` - Review code against design system
- \`review <brand> --code "<code>"\` - Review inline code
- \`suggest <brand> --context "create a button"\` - Get design suggestions
- \`plan <brand> --page-type dashboard --description "Admin panel"\` - Create design plan
- \`apply <brand> --component button --variants primary,secondary\` - Generate component

**Parameters:**
- \`brand\`: Reference design system
- \`file\`: Path to file to review
- \`code\`: Inline code to analyze
- \`context\`: Description of what you're building
- \`page-type\`: landing | dashboard | form | list | detail | custom
- \`component\`: button | card | input | modal | etc.
- \`variants\`: Comma-separated variant names
`
}

function generateExamplesDoc(): string {
  return `# Usage Examples

## Research Tasks

**Get Apple's design system:**
\`\`\`
/design-md get apple
\`\`\`

**Search for fintech design systems:**
\`\`\`
/design-md search fintech
\`\`\`

**List all available brands:**
\`\`\`
/design-md list
\`\`\`

## Analysis Tasks

**Analyze Stripe's color palette:**
\`\`\`
/design-md analyze stripe --type colors
\`\`\`

**Full accessibility audit:**
\`\`\`
/design-md analyze google-material --type accessibility
\`\`\`

**Compare typography systems:**
\`\`\`
/design-md analyze apple --type typography
/design-md analyze linear --type typography
\`\`\`

## Code Generation

**Generate Tailwind config for Linear:**
\`\`\`
/design-md generate linear --output tailwind
\`\`\`

**Generate CSS variables with dark mode:**
\`\`\`
/design-md generate vercel --output css --dark-mode
\`\`\`

**Generate SCSS with components:**
\`\`\`
/design-md generate shopify --output scss --include-components
\`\`\`

## Comparison Tasks

**Compare Apple vs Google Material:**
\`\`\`
/design-md compare apple,google-material
\`\`\`

**Compare with specific attributes:**
\`\`\`
/design-md compare stripe,wise,revolut --compare-by colors,typography
\`\`\`

## Export Tasks

**Extract colors to CSS:**
\`\`\`
/design-md extract stripe --type colors --format css
\`\`\`

**Export to Figma tokens:**
\`\`\`
/design-md extract apple --type full --format figma-tokens
\`\`\`

## Design Consultant Tasks

**Review your login page against Stripe design:**
\`\`\`
/design-md review stripe --file src/pages/Login.tsx
\`\`\`

**Get suggestions for a dashboard sidebar:**
\`\`\`
/design-md suggest linear --context "create a collapsible sidebar for dashboard"
\`\`\`

**Create complete design plan:**
\`\`\`
/design-md plan stripe --page-type dashboard --description "Payment dashboard with stats and charts"
\`\`\`

**Generate button component with variants:**
\`\`\`
/design-md apply stripe --component button --variants primary,secondary,ghost
\`\`\`

**Review inline code snippet:**
\`\`\`
/design-md review apple --code '<div style={{background: "red", padding: "10px"}}>Hello</div>'
\`\`\`

## Complex Workflows

**Research + Generate workflow:**
1. Search: \`/design-md search fintech\`
2. Analyze: \`/design-md analyze stripe --type full\`
3. Generate: \`/design-md generate stripe --output tailwind\`

**Comparison + Migration:**
1. Compare: \`/design-md compare bootstrap,tailwind\`
2. Generate migration guide from comparison results

**Design Review Workflow:**
1. Review: \`/design-md review stripe --file src/components/Button.tsx\`
2. Get score and issues
3. Apply suggestions: \`/design-md suggest stripe --context "fix button styling issues"\`
4. Generate improved component: \`/design-md apply stripe --component button\`

**Full Page Design Workflow:**
1. Plan: \`/design-md plan linear --page-type dashboard --description "Project management dashboard"\`
2. Get color scheme, typography, and component specs
3. Apply to components: \`/design-md apply linear --component sidebar\`
`
}
