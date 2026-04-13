/**
 * Analyze Capability - Design System Analysis
 * 
 * Provides atomic capability for analyzing design systems including
 * color analysis, typography analysis, and accessibility checks.
 */

import type { 
  AnalyzeCapability, 
  AnalyzeInput, 
  AnalyzeOutput,
  ColorPalette,
  TypographySystem,
  ColorAnalysis,
  TypographyAnalysis,
  AccessibilityReport,
  ColorHarmony,
  ContrastInfo,
  AccessibilityIssue
} from '../types'
import { fetchCapability } from './fetch'

export const analyzeCapability: AnalyzeCapability = {
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const { brand, analysisType } = input

    try {
      // Fetch the design system
      const colors = await fetchCapability.getColors(brand)
      const typography = await fetchCapability.getTypography(brand)

      switch (analysisType) {
        case 'colors':
          return {
            success: true,
            brand,
            analysis: this.analyzeColors(colors)
          }
        case 'typography':
          return {
            success: true,
            brand,
            analysis: this.analyzeTypography(typography)
          }
        case 'accessibility':
          return {
            success: true,
            brand,
            analysis: this.analyzeAccessibility(colors, typography)
          }
        case 'full':
        default:
          return {
            success: true,
            brand,
            analysis: {
              colors: this.analyzeColors(colors),
              typography: this.analyzeTypography(typography),
              accessibility: this.analyzeAccessibility(colors, typography),
              overallScore: calculateOverallScore(colors, typography)
            }
          }
      }
    } catch (error) {
      return {
        success: false,
        brand,
        analysis: null as any
      }
    }
  },

  analyzeColors(colors: ColorPalette): ColorAnalysis {
    const colorValues = Object.values(colors).filter(Boolean) as string[]
    
    return {
      palette: colors,
      harmony: detectColorHarmony(colorValues),
      contrastRatios: calculateContrastRatios(colors),
      mood: detectColorMood(colors),
      recommendations: generateColorRecommendations(colors)
    }
  },

  analyzeTypography(typography: TypographySystem): TypographyAnalysis {
    const sizes = typography.sizes || {}
    const sizeValues = Object.values(sizes)

    return {
      fontFamily: typography.fontFamily || 'System default',
      readability: assessReadability(typography),
      hierarchy: extractHierarchy(sizes),
      recommendations: generateTypographyRecommendations(typography)
    }
  },

  analyzeAccessibility(colors: ColorPalette, typography?: TypographySystem): AccessibilityReport {
    const contrastChecks = calculateContrastRatios(colors)
    const issues: AccessibilityIssue[] = []

    // Check contrast issues
    for (const check of contrastChecks) {
      if (!check.wcagAA) {
        issues.push({
          type: 'contrast',
          severity: 'error',
          description: `Insufficient contrast between ${check.foreground} and ${check.background} (${check.ratio.toFixed(2)}:1)`,
          suggestion: 'Adjust colors to meet WCAG AA standards (4.5:1 for normal text)'
        })
      }
    }

    // Check for color-only indicators
    if (Object.keys(colors).length > 0 && !colors.text) {
      issues.push({
        type: 'color-only',
        severity: 'warning',
        description: 'Design may rely on color-only indicators',
        suggestion: 'Add additional visual cues (icons, patterns, labels) alongside color'
      })
    }

    const score = Math.max(0, 100 - issues.length * 15)

    return {
      colorContrast: contrastChecks,
      overallScore: score,
      issues,
      recommendations: issues.map(i => i.suggestion)
    }
  }
}

// Helper functions
function detectColorHarmony(colors: string[]): ColorHarmony {
  if (colors.length === 0) {
    return { type: 'unknown', baseColor: '', relatedColors: [] }
  }

  const baseColor = colors[0]
  
  if (colors.length === 1) {
    return { type: 'monochromatic', baseColor, relatedColors: [] }
  }

  // Simple heuristic based on color count
  if (colors.length === 2) {
    return { type: 'complementary', baseColor, relatedColors: [colors[1]] }
  }

  if (colors.length === 3) {
    return { type: 'triadic', baseColor, relatedColors: colors.slice(1) }
  }

  return { type: 'analogous', baseColor, relatedColors: colors.slice(1) }
}

function calculateContrastRatios(colors: ColorPalette): ContrastInfo[] {
  const checks: ContrastInfo[] = []
  const bg = colors.background || '#ffffff'
  const text = colors.text || '#000000'
  const primary = colors.primary

  // Check text on background
  const textRatio = getContrastRatio(text, bg)
  checks.push({
    foreground: text,
    background: bg,
    ratio: textRatio,
    wcagAA: textRatio >= 4.5,
    wcagAAA: textRatio >= 7
  })

  // Check primary on background
  if (primary) {
    const primaryRatio = getContrastRatio(primary, bg)
    checks.push({
      foreground: primary,
      background: bg,
      ratio: primaryRatio,
      wcagAA: primaryRatio >= 4.5,
      wcagAAA: primaryRatio >= 7
    })
  }

  return checks
}

function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getLuminance(color1)
  const lum2 = getLuminance(color2)
  const brightest = Math.max(lum1, lum2)
  const darkest = Math.min(lum1, lum2)
  return (brightest + 0.05) / (darkest + 0.05)
}

function getLuminance(color: string): number {
  const rgb = parseColor(color)
  if (!rgb) return 0

  const [r, g, b] = rgb.map(c => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function parseColor(color: string): [number, number, number] | null {
  // Hex color
  const hexMatch = color.match(/^#([0-9A-Fa-f]{6})$/)
  if (hexMatch) {
    const hex = hexMatch[1]
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ]
  }

  // Short hex
  const shortHexMatch = color.match(/^#([0-9A-Fa-f]{3})$/)
  if (shortHexMatch) {
    const hex = shortHexMatch[1]
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16)
    ]
  }

  return null
}

function detectColorMood(colors: ColorPalette): string {
  const colorValues = Object.values(colors).filter(Boolean) as string[]
  
  const darkColors = ['#000', '#111', '#222', '#1a1a1a', '#0a0a0a']
  const brightColors = ['#ff', '#ffff', '#ffffff', '#fafafa', '#f5f5f5']
  
  const hasDark = colorValues.some(c => 
    darkColors.some(dc => c.toLowerCase().includes(dc))
  )
  const hasBright = colorValues.some(c => 
    brightColors.some(bc => c.toLowerCase().includes(bc))
  )

  if (hasDark && !hasBright) return 'dark-professional'
  if (hasBright && !hasDark) return 'light-minimal'
  return 'balanced'
}

function generateColorRecommendations(colors: ColorPalette): string[] {
  const recommendations: string[] = []
  
  if (!colors.primary) {
    recommendations.push('Define a primary brand color for consistency')
  }
  if (!colors.background) {
    recommendations.push('Specify background colors for different contexts')
  }
  if (!colors.text) {
    recommendations.push('Define text colors for better readability')
  }

  return recommendations
}

function assessReadability(typography: TypographySystem): 'excellent' | 'good' | 'fair' | 'poor' {
  const sizes = Object.values(typography.sizes || {})
  if (sizes.length === 0) return 'fair'

  const hasBodySize = sizes.some(s => {
    const match = s.match(/(\d+)/)
    return match && parseInt(match[1]) >= 14
  })

  const hasHeadingHierarchy = sizes.length >= 3

  if (hasBodySize && hasHeadingHierarchy) return 'excellent'
  if (hasBodySize || hasHeadingHierarchy) return 'good'
  return 'fair'
}

function extractHierarchy(sizes: Record<string, string>): any[] {
  return Object.entries(sizes).map(([name, size]) => ({
    level: name,
    size,
    weight: 400,
    usage: `${name} text styling`
  }))
}

function generateTypographyRecommendations(typography: TypographySystem): string[] {
  const recommendations: string[] = []

  if (!typography.fontFamily) {
    recommendations.push('Define a primary font family')
  }
  if (!typography.lineHeight) {
    recommendations.push('Specify line heights for better readability')
  }
  if (!typography.sizes || Object.keys(typography.sizes).length < 3) {
    recommendations.push('Establish a clear typographic hierarchy with at least 3 sizes')
  }

  return recommendations
}

function calculateOverallScore(colors: ColorPalette, typography: TypographySystem): number {
  let score = 50

  // Color completeness
  if (colors.primary) score += 10
  if (colors.background) score += 10
  if (colors.text) score += 10

  // Typography completeness
  if (typography.fontFamily) score += 10
  if (typography.sizes && Object.keys(typography.sizes).length >= 3) score += 10

  return Math.min(100, score)
}
