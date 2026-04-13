/**
 * Advise Capability - Design Consultant
 * 
 * Provides intelligent design advice by analyzing user code against
 * design system specifications and generating improvement recommendations.
 */

import type {
  AdviseCapability,
  ReviewInput,
  ReviewOutput,
  SuggestInput,
  SuggestOutput,
  DesignPlanInput,
  DesignPlanOutput,
  ApplyInput,
  ApplyOutput,
  DesignMatch,
  DesignIssue,
  DesignSuggestion,
  ComponentDesignResult,
  ColorUsage,
  TypographyUsage,
  DesignPlan
} from '../types'
import { fetchCapability } from './fetch'

export const adviseCapability: AdviseCapability = {
  async review(input: ReviewInput): Promise<ReviewOutput> {
    const { brand, code, componentName } = input

    try {
      // Fetch design system
      const result = await fetchCapability.get({ brand, format: 'json' })
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          brand,
          score: 0,
          matches: [],
          issues: [{
            severity: 'error',
            category: 'system',
            message: `Failed to load design system: ${result.error}`
          }],
          suggestions: [],
          summary: 'Unable to review - design system not available'
        }
      }

      const system = result.data
      const codeToAnalyze = code || ''

      // Analyze matches and issues
      const matches: DesignMatch[] = []
      const issues: DesignIssue[] = []

      // Check colors
      analyzeColors(codeToAnalyze, system.colors, matches, issues)
      
      // Check typography
      analyzeTypography(codeToAnalyze, system.typography, matches, issues)
      
      // Check spacing (basic heuristics)
      analyzeSpacing(codeToAnalyze, matches, issues)

      // Calculate score
      const score = calculateScore(matches, issues)

      // Generate suggestions
      const suggestions = generateReviewSuggestions(issues, system)

      return {
        success: true,
        brand,
        score,
        matches,
        issues,
        suggestions,
        summary: generateReviewSummary(score, matches, issues, brand)
      }
    } catch (error) {
      return {
        success: false,
        brand,
        score: 0,
        matches: [],
        issues: [{
          severity: 'error',
          category: 'system',
          message: error instanceof Error ? error.message : 'Unknown error'
        }],
        suggestions: [],
        summary: 'Review failed due to an error'
      }
    }
  },

  async suggest(input: SuggestInput): Promise<SuggestOutput> {
    const { brand, context, currentCode, goals = [] } = input

    try {
      const result = await fetchCapability.get({ brand, format: 'json' })
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          suggestions: [],
          summary: 'Unable to provide suggestions - design system not available'
        }
      }

      const system = result.data
      const suggestions: DesignSuggestion[] = []

      // Context-aware suggestions
      if (context.toLowerCase().includes('button') || context.toLowerCase().includes('cta')) {
        suggestions.push(generateButtonSuggestion(system, brand))
      }
      
      if (context.toLowerCase().includes('card') || context.toLowerCase().includes('container')) {
        suggestions.push(generateCardSuggestion(system, brand))
      }
      
      if (context.toLowerCase().includes('form') || context.toLowerCase().includes('input')) {
        suggestions.push(generateFormSuggestion(system, brand))
      }

      if (context.toLowerCase().includes('page') || context.toLowerCase().includes('layout')) {
        suggestions.push(generateLayoutSuggestion(system, brand))
      }

      // Add color scheme suggestion
      suggestions.push(generateColorSchemeSuggestion(system, brand))

      // Add typography suggestion
      suggestions.push(generateTypographySuggestion(system, brand))

      // Filter by goals if specified
      const filteredSuggestions = goals.length > 0
        ? suggestions.filter(s => goals.some(g => 
            s.description.toLowerCase().includes(g.toLowerCase()) ||
            s.rationale.toLowerCase().includes(g.toLowerCase())
          ))
        : suggestions

      return {
        success: true,
        suggestions: filteredSuggestions.length > 0 ? filteredSuggestions : suggestions,
        summary: `Generated ${suggestions.length} design suggestions based on ${brand} design system for: ${context}`
      }
    } catch (error) {
      return {
        success: false,
        suggestions: [],
        summary: `Error generating suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  },

  async createDesignPlan(input: DesignPlanInput): Promise<DesignPlanOutput> {
    const { brand, pageType, description, sections = [], requirements = [] } = input

    try {
      const result = await fetchCapability.get({ brand, format: 'json' })
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          plan: null as any
        }
      }

      const system = result.data
      const plan = buildDesignPlan(system, pageType, description, sections, requirements, brand)

      return {
        success: true,
        plan
      }
    } catch (error) {
      return {
        success: false,
        plan: null as any
      }
    }
  },

  async applyToComponent(input: ApplyInput): Promise<ApplyOutput> {
    const { brand, componentType, variants = [] } = input

    try {
      const result = await fetchCapability.get({ brand, format: 'json' })
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          component: null as any
        }
      }

      const system = result.data
      const component = buildComponent(system, componentType, variants, brand)

      return {
        success: true,
        component
      }
    } catch (error) {
      return {
        success: false,
        component: null as any
      }
    }
  }
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeColors(
  code: string, 
  colors: any, 
  matches: DesignMatch[], 
  issues: DesignIssue[]
): void {
  const colorValues = Object.entries(colors || {}).filter(([, v]) => v) as [string, string][]
  
  for (const [name, value] of colorValues) {
    const hexPattern = value.replace('#', '').toLowerCase()
    const rgbPattern = hexToRgbPattern(value)
    
    if (code.toLowerCase().includes(value.toLowerCase()) || 
        code.toLowerCase().includes(hexPattern)) {
      matches.push({
        category: 'colors',
        element: name,
        expected: value,
        actual: value,
        status: 'match'
      })
    } else if (name === 'primary' || name === 'text') {
      // Check for hardcoded colors that should use design system
      const hardcodedColors = code.match(/#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g)
      if (hardcodedColors && hardcodedColors.length > 0) {
        issues.push({
          severity: 'warning',
          category: 'colors',
          message: `Hardcoded color found: ${hardcodedColors[0]}. Consider using ${name} (${value}) from design system.`,
          fix: `Replace ${hardcodedColors[0]} with var(--color-${name}) or ${value}`
        })
      }
    }
  }
}

function analyzeTypography(
  code: string, 
  typography: any, 
  matches: DesignMatch[], 
  issues: DesignIssue[]
): void {
  const fontFamily = typography?.fontFamily
  
  if (fontFamily) {
    if (code.includes(fontFamily)) {
      matches.push({
        category: 'typography',
        element: 'font-family',
        expected: fontFamily,
        actual: fontFamily,
        status: 'match'
      })
    } else if (code.includes('font-family') || code.includes('fontFamily')) {
      // Font family is specified but might not match
      const fontMatch = code.match(/font-?family[:\s]+['"]?([^'";\s]+)/i)
      if (fontMatch && !fontMatch[1].includes(fontFamily)) {
        issues.push({
          severity: 'suggestion',
          category: 'typography',
          message: `Font family "${fontMatch[1]}" doesn't match design system font "${fontFamily}"`,
          fix: `Consider using font-family: ${fontFamily}`
        })
      }
    }
  }

  // Check for inline font sizes that might not match the scale
  const fontSizeMatches = code.matchAll(/font-?size[:\s]+(\d+(?:\.\d+)?px)/gi)
  for (const match of fontSizeMatches) {
    const size = match[1]
    const definedSizes = Object.values(typography?.sizes || {})
    if (!definedSizes.includes(size)) {
      issues.push({
        severity: 'suggestion',
        category: 'typography',
        message: `Font size ${size} is not in the design system scale`,
        fix: `Consider using one of: ${definedSizes.join(', ')}`
      })
    }
  }
}

function analyzeSpacing(code: string, matches: DesignMatch[], issues: DesignIssue[]): void {
  // Check for consistent spacing values
  const spacingValues = code.matchAll(/(?:margin|padding)[:\s]+(\d+(?:\.\d+)?px|\d+rem)/gi)
  const values = [...spacingValues].map(m => m[1])
  
  if (values.length > 0) {
    // Check if using consistent spacing scale (powers of 2 or 4)
    const irregularSpacings = values.filter(v => {
      const num = parseFloat(v)
      return num > 0 && ![4, 8, 12, 16, 20, 24, 32, 40, 48, 64].includes(num)
    })

    if (irregularSpacings.length > 0) {
      issues.push({
        severity: 'suggestion',
        category: 'spacing',
        message: `Irregular spacing values found: ${irregularSpacings.slice(0, 3).join(', ')}`,
        fix: 'Consider using a consistent spacing scale: 4, 8, 16, 24, 32, 48px'
      })
    }
  }
}

function calculateScore(matches: DesignMatch[], issues: DesignIssue[]): number {
  const baseScore = 50
  const matchBonus = matches.length * 10
  const errorPenalty = issues.filter(i => i.severity === 'error').length * 15
  const warningPenalty = issues.filter(i => i.severity === 'warning').length * 5
  const suggestionPenalty = issues.filter(i => i.severity === 'suggestion').length * 2

  return Math.max(0, Math.min(100, baseScore + matchBonus - errorPenalty - warningPenalty - suggestionPenalty))
}

function generateReviewSuggestions(issues: DesignIssue[], system: any): string[] {
  const suggestions: string[] = []

  if (issues.some(i => i.category === 'colors')) {
    suggestions.push(`Use the ${system.brand} color palette consistently. Primary color: ${system.colors?.primary}`)
  }

  if (issues.some(i => i.category === 'typography')) {
    suggestions.push(`Apply the typography scale: ${system.typography?.fontFamily || 'system font'} with defined sizes`)
  }

  if (issues.some(i => i.category === 'spacing')) {
    suggestions.push('Maintain consistent spacing using the 4px or 8px grid system')
  }

  if (suggestions.length === 0) {
    suggestions.push('Great job! Your design closely follows the design system.')
  }

  return suggestions
}

function generateReviewSummary(score: number, matches: DesignMatch[], issues: DesignIssue[], brand: string): string {
  let summary = `Design Review for ${brand}: Score ${score}/100\n`
  summary += `Matches: ${matches.length}, Issues: ${issues.length}\n`
  
  if (score >= 80) {
    summary += '✅ Your design closely follows the design system.'
  } else if (score >= 50) {
    summary += '⚠️ Partially aligned with the design system. Some improvements needed.'
  } else {
    summary += '❌ Significant deviations from the design system. Review recommended.'
  }

  return summary
}

// ============================================================================
// Suggestion Generators
// ============================================================================

function generateButtonSuggestion(system: any, brand: string): DesignSuggestion {
  const primaryColor = system.colors?.primary || '#007AFF'
  return {
    type: 'component',
    priority: 'high',
    description: `Create buttons using ${brand} primary color`,
    implementation: `\n<button class="btn-primary" style="background-color: ${primaryColor}; color: white; padding: 12px 24px; border-radius: 6px; border: none; font-weight: 500;">\n  Button Text\n</button>\n`,
    rationale: `Primary buttons should use ${brand}'s brand color (${primaryColor}) for consistency and recognition`
  }
}

function generateCardSuggestion(system: any, brand: string): DesignSuggestion {
  const bgColor = system.colors?.surface || system.colors?.background || '#ffffff'
  const borderColor = system.colors?.border || '#e5e5e5'
  return {
    type: 'component',
    priority: 'medium',
    description: `Design cards with ${brand} styling`,
    implementation: `\n<div class="card" style="background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">\n  <h3>Card Title</h3>\n  <p>Card content goes here...</p>\n</div>\n`,
    rationale: `Cards should use the defined surface color (${bgColor}) with subtle borders and shadows`
  }
}

function generateFormSuggestion(system: any, brand: string): DesignSuggestion {
  const borderColor = system.colors?.border || '#d1d5db'
  const focusColor = system.colors?.primary || '#007AFF'
  return {
    type: 'component',
    priority: 'medium',
    description: `Style form inputs according to ${brand}`,
    implementation: `\n<input type="text" class="input" style="border: 1px solid ${borderColor}; border-radius: 6px; padding: 10px 14px; font-size: 16px; transition: border-color 0.2s;" placeholder="Enter text..." />\n\n<style>\n.input:focus {\n  outline: none;\n  border-color: ${focusColor};\n  box-shadow: 0 0 0 3px ${focusColor}20;\n}\n</style>\n`,
    rationale: `Form inputs should have clear focus states using the primary color (${focusColor})`
  }
}

function generateLayoutSuggestion(system: any, brand: string): DesignSuggestion {
  const maxWidth = system.layout?.maxWidth || '1200px'
  return {
    type: 'layout',
    priority: 'high',
    description: `Apply ${brand} layout constraints`,
    implementation: `\n<div class="container" style="max-width: ${maxWidth}; margin: 0 auto; padding: 0 24px;">\n  <!-- Content -->\n</div>\n`,
    rationale: `Use a consistent max-width (${maxWidth}) with responsive padding for optimal readability`
  }
}

function generateColorSchemeSuggestion(system: any, brand: string): DesignSuggestion {
  const colors = system.colors || {}
  const colorVars = Object.entries(colors)
    .filter(([, v]) => v)
    .map(([k, v]) => `  --color-${k}: ${v};`)
    .join('\n')

  return {
    type: 'color',
    priority: 'high',
    description: `Implement ${brand} color system`,
    implementation: `\n:root {\n${colorVars}\n}\n`,
    rationale: `CSS variables ensure consistent color usage and easy theming`
  }
}

function generateTypographySuggestion(system: any, brand: string): DesignSuggestion {
  const fontFamily = system.typography?.fontFamily || 'system-ui, sans-serif'
  return {
    type: 'typography',
    priority: 'medium',
    description: `Apply ${brand} typography scale`,
    implementation: `\nbody {\n  font-family: ${fontFamily};\n  line-height: ${system.typography?.lineHeight || 1.5};\n}\n\nh1 { font-size: ${system.typography?.sizes?.h1 || '2.5rem'}; font-weight: 700; }\nh2 { font-size: ${system.typography?.sizes?.h2 || '2rem'}; font-weight: 600; }\nh3 { font-size: ${system.typography?.sizes?.h3 || '1.5rem'}; font-weight: 600; }\np { font-size: ${system.typography?.sizes?.body || '1rem'}; }\n`,
    rationale: `Consistent typography hierarchy improves readability and visual rhythm`
  }
}

// ============================================================================
// Design Plan Builder
// ============================================================================

function buildDesignPlan(
  system: any, 
  pageType: string, 
  description: string, 
  sections: string[], 
  requirements: string[],
  brand: string
): DesignPlan {
  const colors = system.colors || {}
  const typography = system.typography || {}

  // Build color scheme usage
  const colorScheme: ColorUsage[] = [
    { name: 'Background', value: colors.background || '#ffffff', usage: 'Page background', elements: ['body', 'main'] },
    { name: 'Surface', value: colors.surface || '#fafafa', usage: 'Card/surface backgrounds', elements: ['card', 'modal', 'dropdown'] },
    { name: 'Primary', value: colors.primary || '#007AFF', usage: 'Primary actions, links', elements: ['button-primary', 'link', 'active-state'] },
    { name: 'Text', value: colors.text || '#111827', usage: 'Primary text', elements: ['h1', 'h2', 'h3', 'p', 'label'] },
    { name: 'Text Muted', value: colors.textMuted || '#6b7280', usage: 'Secondary text', elements: ['caption', 'helper-text', 'placeholder'] },
    { name: 'Border', value: colors.border || '#e5e7eb', usage: 'Borders and dividers', elements: ['card-border', 'input-border', 'divider'] }
  ]

  // Build typography scale
  const typographyScale: TypographyUsage[] = [
    { level: 'H1', size: typography.sizes?.h1 || '2.5rem', weight: '700', lineHeight: '1.2', usage: 'Page titles' },
    { level: 'H2', size: typography.sizes?.h2 || '2rem', weight: '600', lineHeight: '1.3', usage: 'Section headings' },
    { level: 'H3', size: typography.sizes?.h3 || '1.5rem', weight: '600', lineHeight: '1.4', usage: 'Subsection headings' },
    { level: 'Body', size: typography.sizes?.body || '1rem', weight: '400', lineHeight: '1.6', usage: 'Paragraph text' },
    { level: 'Small', size: typography.sizes?.small || '0.875rem', weight: '400', lineHeight: '1.5', usage: 'Captions, metadata' }
  ]

  // Layout recommendations
  const layout = {
    maxWidth: system.layout?.maxWidth || '1200px',
    spacing: 'Base 8px grid (8, 16, 24, 32, 48px)',
    grid: '12-column responsive grid',
    breakpoints: system.layout?.breakpoints || {
      mobile: '640px',
      tablet: '768px',
      desktop: '1024px',
      wide: '1280px'
    }
  }

  // Component specs
  const components: any[] = []

  if (pageType === 'landing' || sections.includes('hero')) {
    components.push({
      name: 'Hero Section',
      description: 'Large impactful hero with headline and CTA',
      props: ['title', 'subtitle', 'ctaText', 'ctaAction'],
      code: generateHeroComponent(system)
    })
  }

  if (pageType === 'dashboard' || sections.includes('stats')) {
    components.push({
      name: 'Stat Card',
      description: 'Metric display card with trend indicator',
      props: ['label', 'value', 'change', 'trend'],
      code: generateStatCard(system)
    })
  }

  if (sections.includes('form') || pageType === 'form') {
    components.push({
      name: 'Form Field',
      description: 'Labeled input with validation support',
      props: ['label', 'type', 'placeholder', 'error'],
      code: generateFormField(system)
    })
  }

  // Always include button
  components.push({
    name: 'Button',
    description: 'Primary and secondary action buttons',
    props: ['variant', 'size', 'disabled', 'onClick'],
    code: generateButtonComponent(system)
  })

  // Code examples
  const codeExamples = [
    {
      title: 'Page Layout',
      description: 'Responsive page structure',
      code: generatePageLayout(system, pageType),
      language: 'tsx'
    },
    {
      title: 'CSS Variables',
      description: 'Design tokens as CSS custom properties',
      code: generateCSSVariables(system),
      language: 'css'
    }
  ]

  return {
    overview: `${brand} Design Plan for ${pageType}: ${description}\n\nThis plan implements the ${brand} design system with a focus on ${requirements.join(', ') || 'consistency and usability'}.`,
    colorScheme,
    typographyScale,
    layout,
    components,
    codeExamples
  }
}

// ============================================================================
// Component Builders
// ============================================================================

function buildComponent(system: any, type: string, variants: string[], brand: string): ComponentDesignResult {
  const componentBuilders: Record<string, () => ComponentDesignResult> = {
    button: () => ({
      name: 'Button',
      description: `${brand} styled button component with variants`,
      code: generateButtonComponent(system),
      css: generateButtonCSS(system, variants),
      variants: variants.reduce((acc, v) => ({ ...acc, [v]: `${v} variant styles` }), {}),
      usage: `<Button variant="primary" size="md">Click me</Button>`
    }),
    card: () => ({
      name: 'Card',
      description: `${brand} styled card container`,
      code: generateCardComponent(system),
      css: generateCardCSS(system),
      usage: `<Card><Card.Header>Title</Card.Header><Card.Body>Content</Card.Body></Card>`
    }),
    input: () => ({
      name: 'Input',
      description: `${brand} styled form input`,
      code: generateInputComponent(system),
      css: generateInputCSS(system),
      usage: `<Input placeholder="Enter text" />`
    }),
    modal: () => ({
      name: 'Modal',
      description: `${brand} styled modal/dialog`,
      code: generateModalComponent(system),
      css: generateModalCSS(system),
      usage: `<Modal isOpen={true} onClose={handleClose}><Modal.Title>Title</Modal.Title></Modal>`
    })
  }

  const builder = componentBuilders[type.toLowerCase()]
  if (builder) {
    return builder()
  }

  return {
    name: type,
    description: `${brand} styled ${type} component`,
    code: `// ${type} component implementation\n<div className="${type}">Component</div>`,
    css: `.${type} { /* styles */ }`,
    usage: `<${type.charAt(0).toUpperCase() + type.slice(1)} />`
  }
}

// ============================================================================
// Code Generators
// ============================================================================

function generateHeroComponent(system: any): string {
  return `<section className="hero" style={{ 
  background: '${system.colors?.background || '#fff'}',
  padding: '80px 24px',
  textAlign: 'center'
}}>
  <h1 style={{ 
    fontSize: '${system.typography?.sizes?.h1 || '3rem'}',
    color: '${system.colors?.text || '#111'}',
    marginBottom: '24px'
  }}>
    {title}
  </h1>
  <p style={{ 
    fontSize: '${system.typography?.sizes?.body || '1.25rem'}',
    color: '${system.colors?.textMuted || '#666'}',
    maxWidth: '600px',
    margin: '0 auto 32px'
  }}>
    {subtitle}
  </p>
  <button style={{
    background: '${system.colors?.primary || '#007AFF'}',
    color: 'white',
    padding: '16px 32px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '1.125rem',
    fontWeight: 500
  }}>
    {ctaText}
  </button>
</section>`
}

function generateStatCard(system: any): string {
  return `<div className="stat-card" style={{
  background: '${system.colors?.surface || '#fafafa'}',
  border: '1px solid ${system.colors?.border || '#e5e5e5'}',
  borderRadius: '12px',
  padding: '24px'
}}>
  <p style={{ color: '${system.colors?.textMuted || '#666'}', fontSize: '0.875rem' }}>
    {label}
  </p>
  <h3 style={{ 
    fontSize: '${system.typography?.sizes?.h2 || '2rem'}',
    color: '${system.colors?.text || '#111'}',
    margin: '8px 0'
  }}>
    {value}
  </h3>
  <span style={{ color: trend === 'up' ? '#10b981' : '#ef4444' }}>
    {change}
  </span>
</div>`
}

function generateFormField(system: any): string {
  return `<div className="form-field">
  <label style={{
    display: 'block',
    marginBottom: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '${system.colors?.text || '#111'}'
  }}>
    {label}
  </label>
  <input style={{
    width: '100%',
    padding: '10px 14px',
    border: '1px solid ${system.colors?.border || '#d1d5db'}',
    borderRadius: '6px',
    fontSize: '1rem',
    transition: 'border-color 0.2s'
  }} />
</div>`
}

function generateButtonComponent(system: any): string {
  return `<button className="btn-primary" style={{
  background: '${system.colors?.primary || '#007AFF'}',
  color: 'white',
  padding: '12px 24px',
  borderRadius: '6px',
  border: 'none',
  fontWeight: 500,
  cursor: 'pointer'
}}>
  {children}
</button>`
}

function generateCardComponent(system: any): string {
  return `<div className="card" style={{
  background: '${system.colors?.surface || '#fff'}',
  border: '1px solid ${system.colors?.border || '#e5e5e5'}',
  borderRadius: '8px',
  padding: '24px'
}}>
  {children}
</div>`
}

function generateInputComponent(system: any): string {
  return `<input className="input" style={{
  width: '100%',
  padding: '10px 14px',
  border: '1px solid ${system.colors?.border || '#d1d5db'}',
  borderRadius: '6px',
  fontSize: '1rem'
}} />`
}

function generateModalComponent(system: any): string {
  return `<div className="modal-overlay" style={{
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}}>
  <div className="modal" style={{
    background: '${system.colors?.surface || '#fff'}',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%'
  }}>
    {children}
  </div>
</div>`
}

function generatePageLayout(system: any, pageType: string): string {
  return `export default function ${pageType.charAt(0).toUpperCase() + pageType.slice(1)}Page() {
  return (
    <div className="page" style={{ minHeight: '100vh', background: '${system.colors?.background || '#fff'}' }}>
      <header style={{ borderBottom: '1px solid ${system.colors?.border || '#e5e5e5'}', padding: '16px 24px' }}>
        {/* Header content */}
      </header>
      <main style={{ maxWidth: '${system.layout?.maxWidth || '1200px'}', margin: '0 auto', padding: '24px' }}>
        {/* Page content */}
      </main>
    </div>
  )
}`
}

function generateCSSVariables(system: any): string {
  const colors = Object.entries(system.colors || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `  --color-${k}: ${v};`)
    .join('\n')

  return `:root {
${colors}
  
  --font-family: ${system.typography?.fontFamily || 'system-ui, sans-serif'};
  --line-height: ${system.typography?.lineHeight || '1.5'};
  
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
}`
}

function generateButtonCSS(system: any, variants: string[]): string {
  const primary = system.colors?.primary || '#007AFF'
  return `.btn {
  padding: 12px 24px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: ${primary};
  color: white;
  border: none;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  background: transparent;
  color: ${primary};
  border: 1px solid ${primary};
}`
}

function generateCardCSS(system: any): string {
  return `.card {
  background: ${system.colors?.surface || '#fff'};
  border: 1px solid ${system.colors?.border || '#e5e5e5'};
  border-radius: 8px;
  padding: 24px;
}`
}

function generateInputCSS(system: any): string {
  const focusColor = system.colors?.primary || '#007AFF'
  return `.input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid ${system.colors?.border || '#d1d5db'};
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s;
}

.input:focus {
  outline: none;
  border-color: ${focusColor};
  box-shadow: 0 0 0 3px ${focusColor}20;
}`
}

function generateModalCSS(system: any): string {
  return `.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  background: ${system.colors?.surface || '#fff'};
  border-radius: 12px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}`
}

// ============================================================================
// Utilities
// ============================================================================

function hexToRgbPattern(hex: string): string {
  // Convert hex to rgb() pattern for matching
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return hex
  
  const r = parseInt(match[1], 16)
  const g = parseInt(match[2], 16)
  const b = parseInt(match[3], 16)
  
  return `rgb(${r}, ${g}, ${b})`
}
