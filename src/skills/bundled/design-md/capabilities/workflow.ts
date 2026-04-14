/**
 * Workflow Capability - Intelligent Design Assistant
 *
 * Provides automated design workflows that orchestrate multiple capabilities
 * to deliver complete design solutions without manual command chaining.
 */

import type {
  WorkflowInput,
  WorkflowOutput,
  DesignContext,
  WorkflowStep,
  WorkflowResult
} from '../types'
import { fetchCapability } from './fetch'
import { analyzeCapability } from './analyze'
import { adviseCapability } from './advise'
import { generateCapability } from './generate'
import { searchCapability } from './search'

export const workflowCapability = {
  async execute(input: WorkflowInput): Promise<WorkflowOutput> {
    const { context, filePath, code, requirements } = input

    try {
      // Step 1: Analyze intent and determine workflow type
      const workflowType = detectWorkflowType(context, filePath, code)
      
      // Step 2: Select appropriate design system based on context
      const recommendedBrand = await selectDesignSystem(context, requirements)
      
      // Step 3: Execute workflow based on type
      switch (workflowType) {
        case 'design-from-scratch':
          return await executeDesignWorkflow(context, recommendedBrand, requirements)
        case 'review-existing':
          return await executeReviewWorkflow(filePath, code, recommendedBrand)
        case 'migrate-design':
          return await executeMigrationWorkflow(context, filePath, recommendedBrand)
        case 'enhance-component':
          return await executeEnhancementWorkflow(context, code, recommendedBrand)
        default:
          return await executeGenericWorkflow(context, recommendedBrand)
      }
    } catch (error) {
      return {
        success: false,
        workflowType: 'unknown',
        steps: [],
        result: null,
        error: error instanceof Error ? error.message : 'Workflow execution failed'
      }
    }
  }
}

/**
 * Detect workflow type based on user input
 */
function detectWorkflowType(
  context: string,
  filePath?: string,
  code?: string
): WorkflowStep['type'] {
  const lowerContext = context.toLowerCase()
  
  // Design from scratch patterns
  if (
    lowerContext.includes('创建') ||
    lowerContext.includes('设计') ||
    lowerContext.includes('新建') ||
    lowerContext.includes('create') ||
    lowerContext.includes('design') ||
    lowerContext.includes('build')
  ) {
    return 'design-from-scratch'
  }
  
  // Review patterns
  if (
    lowerContext.includes('审查') ||
    lowerContext.includes('检查') ||
    lowerContext.includes('review') ||
    lowerContext.includes('check') ||
    lowerContext.includes('audit')
  ) {
    return 'review-existing'
  }
  
  // Migration patterns
  if (
    lowerContext.includes('迁移') ||
    lowerContext.includes('转换') ||
    lowerContext.includes('migrate') ||
    lowerContext.includes('convert') ||
    lowerContext.includes('upgrade')
  ) {
    return 'migrate-design'
  }
  
  // Enhancement patterns
  if (
    lowerContext.includes('优化') ||
    lowerContext.includes('改进') ||
    lowerContext.includes('enhance') ||
    lowerContext.includes('improve') ||
    lowerContext.includes('refactor')
  ) {
    return 'enhance-component'
  }
  
  // If file/code provided without specific intent, default to review
  if (filePath || code) {
    return 'review-existing'
  }
  
  return 'generic'
}

/**
 * Select appropriate design system based on context
 */
async function selectDesignSystem(
  context: string,
  requirements?: string[]
): Promise<string> {
  const lowerContext = context.toLowerCase()
  
  // Map context to recommended brands
  const brandMappings: Record<string, string[]> = {
    'fintech': ['stripe', 'wise', 'revolut'],
    'payment': ['stripe', 'wise'],
    'dashboard': ['linear', 'vercel', 'notion'],
    'admin': ['linear', 'vercel'],
    'saas': ['linear', 'notion', 'vercel'],
    'landing': ['linear', 'stripe', 'apple'],
    'marketing': ['stripe', 'apple', 'nike'],
    'ecommerce': ['shopify', 'stripe', 'nike'],
    'developer': ['vercel', 'linear', 'cursor'],
    'api': ['stripe', 'vercel'],
    'mobile': ['apple', 'uber'],
    'social': ['meta', 'pinterest'],
  }
  
  // Find matching category
  for (const [category, brands] of Object.entries(brandMappings)) {
    if (lowerContext.includes(category)) {
      return brands[0] // Return first match
    }
  }
  
  // Default to versatile design systems
  return 'linear'
}

/**
 * Execute design-from-scratch workflow
 */
async function executeDesignWorkflow(
  context: string,
  brand: string,
  requirements?: string[]
): Promise<WorkflowOutput> {
  const steps: WorkflowStep[] = []
  
  // Step 1: Fetch design system
  steps.push({ type: 'fetch', description: `Fetching ${brand} design system` })
  const designSystem = await fetchCapability.get({ brand, format: 'json' })
  if (!designSystem.success) {
    throw new Error(`Failed to fetch design system: ${designSystem.error}`)
  }
  
  // Step 2: Analyze design system
  steps.push({ type: 'analyze', description: 'Analyzing design patterns' })
  const analysis = await analyzeCapability.analyze({
    brand,
    analysisType: 'full'
  })
  
  // Step 3: Generate design plan
  steps.push({ type: 'plan', description: 'Creating design plan' })
  const plan = await adviseCapability.createDesignPlan({
    brand,
    pageType: detectPageType(context),
    description: context,
    requirements
  })
  
  // Step 4: Generate code
  steps.push({ type: 'generate', description: 'Generating component code' })
  const generated = await generateCapability.generate({
    brand,
    outputType: 'css',
    options: { includeComponents: true }
  })
  
  return {
    success: true,
    workflowType: 'design-from-scratch',
    steps,
    result: {
      brand,
      designSystem: designSystem.data,
      analysis: analysis.analysis,
      plan: plan.plan,
      code: generated.code,
      language: generated.language
    }
  }
}

/**
 * Execute review-existing workflow
 */
async function executeReviewWorkflow(
  filePath: string | undefined,
  code: string | undefined,
  brand: string
): Promise<WorkflowOutput> {
  const steps: WorkflowStep[] = []
  
  // Step 1: Review code
  steps.push({ type: 'review', description: 'Reviewing code against design system' })
  const review = await adviseCapability.review({
    brand,
    filePath,
    code
  })
  
  // Step 2: Generate suggestions
  steps.push({ type: 'suggest', description: 'Generating improvement suggestions' })
  const suggestions = await adviseCapability.suggest({
    brand,
    context: 'Improve design compliance',
    currentCode: code,
    goals: ['fix issues', 'improve consistency']
  })
  
  return {
    success: true,
    workflowType: 'review-existing',
    steps,
    result: {
      brand,
      review: review,
      suggestions: suggestions.suggestions,
      score: review.score
    }
  }
}

/**
 * Execute migration workflow
 */
async function executeMigrationWorkflow(
  context: string,
  filePath: string | undefined,
  targetBrand: string
): Promise<WorkflowOutput> {
  const steps: WorkflowStep[] = []
  
  // Detect source design system
  const sourceBrand = detectSourceDesignSystem(context)
  
  steps.push({ type: 'analyze', description: `Analyzing ${sourceBrand} design system` })
  steps.push({ type: 'migrate', description: `Migrating to ${targetBrand}` })
  
  // This would involve comparing and generating migration guide
  // Implementation depends on specific requirements
  
  return {
    success: true,
    workflowType: 'migrate-design',
    steps,
    result: {
      sourceBrand,
      targetBrand,
      migrationGuide: 'Migration guide would be generated here'
    }
  }
}

/**
 * Execute component enhancement workflow
 */
async function executeEnhancementWorkflow(
  context: string,
  code: string | undefined,
  brand: string
): Promise<WorkflowOutput> {
  const steps: WorkflowStep[] = []
  
  // Step 1: Review current implementation
  steps.push({ type: 'review', description: 'Reviewing current implementation' })
  const review = await adviseCapability.review({
    brand,
    code
  })
  
  // Step 2: Apply design system
  steps.push({ type: 'apply', description: 'Applying design system' })
  const componentType = detectComponentType(context, code)
  const applied = await adviseCapability.applyToComponent({
    brand,
    componentType,
    currentCode: code
  })
  
  return {
    success: true,
    workflowType: 'enhance-component',
    steps,
    result: {
      brand,
      componentType,
      review: review,
      improvedCode: applied.component
    }
  }
}

/**
 * Execute generic workflow
 */
async function executeGenericWorkflow(
  context: string,
  brand: string
): Promise<WorkflowOutput> {
  const steps: WorkflowStep[] = []
  
  steps.push({ type: 'fetch', description: `Fetching ${brand} design system` })
  const designSystem = await fetchCapability.get({ brand, format: 'json' })
  
  steps.push({ type: 'analyze', description: 'Analyzing design patterns' })
  const analysis = await analyzeCapability.analyze({
    brand,
    analysisType: 'full'
  })
  
  return {
    success: true,
    workflowType: 'generic',
    steps,
    result: {
      brand,
      designSystem: designSystem.data,
      analysis: analysis.analysis
    }
  }
}

/**
 * Helper: Detect page type from context
 */
function detectPageType(context: string): 'landing' | 'dashboard' | 'form' | 'list' | 'detail' | 'custom' {
  const lower = context.toLowerCase()
  if (lower.includes('landing') || lower.includes('home')) return 'landing'
  if (lower.includes('dashboard') || lower.includes('admin')) return 'dashboard'
  if (lower.includes('form') || lower.includes('login') || lower.includes('signup')) return 'form'
  if (lower.includes('list') || lower.includes('table') || lower.includes('grid')) return 'list'
  if (lower.includes('detail') || lower.includes('profile') || lower.includes('page')) return 'detail'
  return 'custom'
}

/**
 * Helper: Detect component type
 */
function detectComponentType(context: string, code?: string): string {
  const lower = context.toLowerCase()
  if (lower.includes('button')) return 'button'
  if (lower.includes('card')) return 'card'
  if (lower.includes('input') || lower.includes('form')) return 'input'
  if (lower.includes('modal') || lower.includes('dialog')) return 'modal'
  if (lower.includes('nav') || lower.includes('menu')) return 'navigation'
  if (lower.includes('table') || lower.includes('list')) return 'table'
  return 'generic'
}

/**
 * Helper: Detect source design system
 */
function detectSourceDesignSystem(context: string): string {
  const lower = context.toLowerCase()
  if (lower.includes('bootstrap')) return 'bootstrap'
  if (lower.includes('material') || lower.includes('mui')) return 'material-ui'
  if (lower.includes('ant')) return 'antd'
  if (lower.includes('tailwind')) return 'tailwind'
  return 'unknown'
}
