/**
 * Design-MD Atomic Capability Module - Type Definitions
 * 
 * This module provides AI-callable atomic capabilities for frontend design tasks,
 * enabling the AI system to fetch, analyze, generate, and compare design systems
 * from the awesome-design-md collection.
 */

// ============================================================================
// Core Data Types
// ============================================================================

export interface DesignSystem {
  brand: string
  url: string
  theme: ThemeInfo
  colors: ColorPalette
  typography: TypographySystem
  components: ComponentInfo[]
  layout?: LayoutSystem
  guidelines?: string[]
  responsive?: ResponsiveConfig
  raw?: Record<string, unknown>
}

export interface ThemeInfo {
  description: string
  keywords: string[]
  mood: 'modern' | 'professional' | 'playful' | 'elegant' | 'tech' | 'neutral'
}

export interface ColorPalette {
  primary?: string
  secondary?: string
  accent?: string
  background?: string
  surface?: string
  text?: string
  textMuted?: string
  border?: string
  [key: string]: string | undefined
}

export interface TypographySystem {
  fontFamily?: string
  fontStack?: string
  sizes?: Record<string, string>
  lineHeight?: string | number
  weights?: (string | number)[]
  letterSpacing?: string
}

export interface ComponentInfo {
  name: string
  description: string
  variants?: string[]
  states?: string[]
}

export interface LayoutSystem {
  spacing?: string | Record<string, string>
  grid?: string | Record<string, string>
  breakpoints?: Record<string, string>
  maxWidth?: string
}

export interface ResponsiveConfig {
  mobile?: string
  tablet?: string
  desktop?: string
  wide?: string
}

// ============================================================================
// Capability Input/Output Types
// ============================================================================

export interface FetchInput {
  brand: string
  format?: 'markdown' | 'json' | 'html'
  theme?: 'light' | 'dark'
  section?: 'all' | 'colors' | 'typography' | 'components' | 'layout'
}

export interface FetchOutput {
  success: boolean
  brand: string
  data: DesignSystem | string
  format: 'markdown' | 'json' | 'html'
  previewUrl?: string
  error?: string
}

export interface SearchInput {
  query: string
  category?: string
  limit?: number
}

export interface SearchOutput {
  success: boolean
  results: BrandInfo[]
  total: number
  categories: string[]
  query: string
}

export interface BrandInfo {
  name: string
  category: string
  description: string
  designUrl: string
  previewUrl: string
}

export interface AnalyzeInput {
  brand: string
  analysisType: 'colors' | 'typography' | 'accessibility' | 'full'
}

export interface AnalyzeOutput {
  success: boolean
  brand: string
  analysis: ColorAnalysis | TypographyAnalysis | AccessibilityReport | FullAnalysis
}

export interface ColorAnalysis {
  palette: ColorPalette
  harmony: ColorHarmony
  contrastRatios: ContrastInfo[]
  mood: string
  recommendations: string[]
}

export interface ColorHarmony {
  type: 'complementary' | 'analogous' | 'triadic' | 'monochromatic' | 'unknown'
  baseColor: string
  relatedColors: string[]
}

export interface ContrastInfo {
  foreground: string
  background: string
  ratio: number
  wcagAA: boolean
  wcagAAA: boolean
}

export interface TypographyAnalysis {
  fontFamily: string
  readability: 'excellent' | 'good' | 'fair' | 'poor'
  hierarchy: HeadingLevel[]
  recommendations: string[]
}

export interface HeadingLevel {
  level: string
  size: string
  weight: number | string
  usage: string
}

export interface AccessibilityReport {
  colorContrast: ContrastInfo[]
  overallScore: number
  issues: AccessibilityIssue[]
  recommendations: string[]
}

export interface AccessibilityIssue {
  type: 'contrast' | 'color-only' | 'font-size' | 'spacing'
  severity: 'error' | 'warning' | 'info'
  description: string
  suggestion: string
}

export interface FullAnalysis {
  colors: ColorAnalysis
  typography: TypographyAnalysis
  accessibility: AccessibilityReport
  overallScore: number
}

export interface GenerateInput {
  brand: string
  outputType: 'css' | 'tailwind' | 'scss' | 'styled-components'
  options?: GenerateOptions
}

export interface GenerateOptions {
  includeVariables?: boolean
  includeComponents?: boolean
  darkMode?: boolean
  prefix?: string
}

export interface GenerateOutput {
  success: boolean
  brand: string
  code: string
  language: string
  filename?: string
}

export interface CompareInput {
  brands: string[]
  compareBy?: ('colors' | 'typography' | 'layout' | 'components')[]
}

export interface CompareOutput {
  success: boolean
  comparison: BrandComparison[]
  summary: ComparisonSummary
  recommendations: string[]
}

export interface BrandComparison {
  brand: string
  colors: ColorPalette
  typography: TypographySystem
  components: ComponentInfo[]
  similarity: number
}

export interface ComparisonSummary {
  totalBrands: number
  commonColors: string[]
  uniqueFonts: string[]
  themeDistribution: Record<string, number>
  bestFor: Record<string, string>
}

export interface ExtractInput {
  brand: string
  extractType: 'colors' | 'typography' | 'components' | 'full'
  format?: 'json' | 'css' | 'figma-tokens'
}

export interface ExtractOutput {
  success: boolean
  brand: string
  extracted: unknown
  format: string
}

export interface ListOutput {
  success: boolean
  categories: CategoryInfo[]
  totalBrands: number
  brands: string[]
}

export interface CategoryInfo {
  id: string
  name: string
  description: string
  brands: string[]
  count: number
}

// ============================================================================
// Capability Interface Definitions
// ============================================================================

export interface FetchCapability {
  get(input: FetchInput): Promise<FetchOutput>
  getColors(brand: string): Promise<ColorPalette>
  getTypography(brand: string): Promise<TypographySystem>
  getComponents(brand: string): Promise<ComponentInfo[]>
}

export interface SearchCapability {
  search(input: SearchInput): Promise<SearchOutput>
  list(): Promise<ListOutput>
  getCategories(): Promise<CategoryInfo[]>
}

export interface AnalyzeCapability {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>
  analyzeColors(colors: ColorPalette): ColorAnalysis
  analyzeTypography(typography: TypographySystem): TypographyAnalysis
  analyzeAccessibility(colors: ColorPalette, typography?: TypographySystem): AccessibilityReport
}

export interface GenerateCapability {
  generate(input: GenerateInput): Promise<GenerateOutput>
  generateCSS(system: DesignSystem, options?: GenerateOptions): string
  generateTailwind(system: DesignSystem, options?: GenerateOptions): string
  generateSCSS(system: DesignSystem, options?: GenerateOptions): string
}

export interface CompareCapability {
  compare(input: CompareInput): Promise<CompareOutput>
  generateMigration(from: string, to: string): Promise<string>
}

export interface ExtractCapability {
  extract(input: ExtractInput): Promise<ExtractOutput>
  exportToFormat(system: DesignSystem, format: 'figma' | 'sketch' | 'xd'): Promise<unknown>
}

// ============================================================================
// Unified Capability Registry
// ============================================================================

// ============================================================================
// Advise Capability Types (Design Consultant)
// ============================================================================

export interface ReviewInput {
  brand: string
  filePath?: string
  code?: string
  componentName?: string
}

export interface ReviewOutput {
  success: boolean
  brand: string
  score: number
  matches: DesignMatch[]
  issues: DesignIssue[]
  suggestions: string[]
  summary: string
}

export interface DesignMatch {
  category: 'colors' | 'typography' | 'spacing' | 'layout' | 'components'
  element: string
  expected: string
  actual: string
  status: 'match' | 'close' | 'mismatch'
}

export interface DesignIssue {
  severity: 'error' | 'warning' | 'suggestion'
  category: string
  message: string
  fix?: string
  line?: number
}

export interface SuggestInput {
  brand: string
  context: string
  currentCode?: string
  goals?: string[]
}

export interface SuggestOutput {
  success: boolean
  suggestions: DesignSuggestion[]
  summary: string
}

export interface DesignSuggestion {
  type: 'color' | 'typography' | 'spacing' | 'layout' | 'component'
  priority: 'high' | 'medium' | 'low'
  description: string
  implementation: string
  rationale: string
}

export interface DesignPlanInput {
  brand: string
  pageType: 'landing' | 'dashboard' | 'form' | 'list' | 'detail' | 'custom'
  description: string
  sections?: string[]
  requirements?: string[]
}

export interface DesignPlanOutput {
  success: boolean
  plan: DesignPlan
}

export interface DesignPlan {
  overview: string
  colorScheme: ColorUsage[]
  typographyScale: TypographyUsage[]
  layout: LayoutRecommendation
  components: ComponentDesignSpec[]
  codeExamples: CodeExample[]
}

export interface ColorUsage {
  name: string
  value: string
  usage: string
  elements: string[]
}

export interface TypographyUsage {
  level: string
  size: string
  weight: string
  lineHeight: string
  usage: string
}

export interface LayoutRecommendation {
  maxWidth: string
  spacing: string
  grid: string
  breakpoints: Record<string, string>
}

export interface ComponentDesignSpec {
  name: string
  description: string
  props?: string[]
  code: string
}

export interface CodeExample {
  title: string
  description: string
  code: string
  language: string
}

export interface ApplyInput {
  brand: string
  componentType: string
  currentCode?: string
  variants?: string[]
}

export interface ApplyOutput {
  success: boolean
  component: ComponentDesignResult
}

export interface ComponentDesignResult {
  name: string
  description: string
  code: string
  css: string
  variants?: Record<string, string>
  usage: string
}

// ============================================================================
// Capability Interfaces
// ============================================================================

export interface AdviseCapability {
  review(input: ReviewInput): Promise<ReviewOutput>
  suggest(input: SuggestInput): Promise<SuggestOutput>
  createDesignPlan(input: DesignPlanInput): Promise<DesignPlanOutput>
  applyToComponent(input: ApplyInput): Promise<ApplyOutput>
}

// ============================================================================
// Unified Capability Registry
// ============================================================================

export type CapabilityType = 'fetch' | 'search' | 'analyze' | 'generate' | 'compare' | 'extract' | 'advise'

export interface CapabilityRegistry {
  fetch: FetchCapability
  search: SearchCapability
  analyze: AnalyzeCapability
  generate: GenerateCapability
  compare: CompareCapability
  extract: ExtractCapability
  advise: AdviseCapability
}

export type CapabilityInput = 
  | { type: 'fetch'; input: FetchInput }
  | { type: 'search'; input: SearchInput }
  | { type: 'analyze'; input: AnalyzeInput }
  | { type: 'generate'; input: GenerateInput }
  | { type: 'compare'; input: CompareInput }
  | { type: 'extract'; input: ExtractInput }
  | { type: 'advise'; input: AdviseInput }
  | { type: 'list'; input?: undefined }

export type AdviseInput = 
  | { action: 'review'; data: ReviewInput }
  | { action: 'suggest'; data: SuggestInput }
  | { action: 'plan'; data: DesignPlanInput }
  | { action: 'apply'; data: ApplyInput }

export type CapabilityOutput = 
  | FetchOutput 
  | SearchOutput 
  | AnalyzeOutput 
  | GenerateOutput 
  | CompareOutput 
  | ExtractOutput
  | ReviewOutput
  | SuggestOutput
  | DesignPlanOutput
  | ApplyOutput
  | ListOutput
