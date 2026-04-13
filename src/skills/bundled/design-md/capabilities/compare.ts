/**
 * Compare Capability - Design System Comparison
 * 
 * Provides atomic capability for comparing multiple design systems
 * and generating migration guides.
 */

import type { 
  CompareCapability, 
  CompareInput, 
  CompareOutput,
  BrandComparison,
  ComparisonSummary,
  DesignSystem,
  ColorPalette,
  TypographySystem
} from '../types'
import { fetchCapability } from './fetch'

export const compareCapability: CompareCapability = {
  async compare(input: CompareInput): Promise<CompareOutput> {
    const { brands, compareBy = ['colors', 'typography', 'layout'] } = input

    try {
      // Fetch all design systems
      const systems = await Promise.all(
        brands.map(async brand => {
          const result = await fetchCapability.get({ brand, format: 'json' })
          return {
            brand,
            system: result.success && typeof result.data === 'object' 
              ? result.data as DesignSystem 
              : null
          }
        })
      )

      // Build comparison data
      const comparisons: BrandComparison[] = systems.map(({ brand, system }) => ({
        brand,
        colors: system?.colors || {},
        typography: system?.typography || {},
        components: system?.components || [],
        similarity: 0 // Will be calculated
      }))

      // Calculate similarities
      for (let i = 0; i < comparisons.length; i++) {
        comparisons[i].similarity = calculateSimilarity(comparisons[i], comparisons)
      }

      const summary = generateSummary(comparisons)
      const recommendations = generateRecommendations(comparisons, summary)

      return {
        success: true,
        comparison: comparisons,
        summary,
        recommendations
      }
    } catch (error) {
      return {
        success: false,
        comparison: [],
        summary: {
          totalBrands: brands.length,
          commonColors: [],
          uniqueFonts: [],
          themeDistribution: {},
          bestFor: {}
        },
        recommendations: [`Error: ${error instanceof Error ? error.message : String(error)}`]
      }
    }
  },

  async generateMigration(from: string, to: string): Promise<string> {
    try {
      const [fromResult, toResult] = await Promise.all([
        fetchCapability.get({ brand: from, format: 'json' }),
        fetchCapability.get({ brand: to, format: 'json' })
      ])

      if (!fromResult.success || !toResult.success) {
        return `Failed to fetch design systems for migration analysis`
      }

      const fromSystem = fromResult.data as DesignSystem
      const toSystem = toResult.data as DesignSystem

      return generateMigrationGuide(fromSystem, toSystem)
    } catch (error) {
      return `Error generating migration guide: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function calculateSimilarity(target: BrandComparison, all: BrandComparison[]): number {
  if (all.length <= 1) return 100

  let totalSimilarity = 0
  let comparisons = 0

  for (const other of all) {
    if (other.brand === target.brand) continue

    let similarity = 0
    let factors = 0

    // Color similarity
    const targetColors = Object.values(target.colors).filter(Boolean)
    const otherColors = Object.values(other.colors).filter(Boolean)
    if (targetColors.length > 0 && otherColors.length > 0) {
      const commonColors = targetColors.filter(c => 
        otherColors.some(oc => colorDistance(c as string, oc as string) < 50)
      )
      similarity += (commonColors.length / Math.max(targetColors.length, otherColors.length)) * 100
      factors++
    }

    // Typography similarity
    if (target.typography.fontFamily && other.typography.fontFamily) {
      similarity += target.typography.fontFamily === other.typography.fontFamily ? 100 : 0
      factors++
    }

    if (factors > 0) {
      totalSimilarity += similarity / factors
      comparisons++
    }
  }

  return comparisons > 0 ? Math.round(totalSimilarity / comparisons) : 0
}

function colorDistance(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  
  if (!rgb1 || !rgb2) return 255

  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  )
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

function generateSummary(comparisons: BrandComparison[]): ComparisonSummary {
  // Collect all colors
  const allColors = new Set<string>()
  const colorCounts: Record<string, number> = {}
  
  for (const comp of comparisons) {
    for (const [name, value] of Object.entries(comp.colors)) {
      if (value) {
        allColors.add(value)
        colorCounts[value] = (colorCounts[value] || 0) + 1
      }
    }
  }

  // Find common colors (appear in multiple brands)
  const commonColors = Object.entries(colorCounts)
    .filter(([, count]) => count > 1)
    .map(([color]) => color)
    .slice(0, 5)

  // Collect unique fonts
  const fonts = new Set<string>()
  for (const comp of comparisons) {
    if (comp.typography.fontFamily) {
      fonts.add(comp.typography.fontFamily)
    }
  }

  // Theme distribution
  const themeDistribution: Record<string, number> = {}
  for (const comp of comparisons) {
    const primary = comp.colors.primary
    const theme = primary ? detectTheme(primary) : 'neutral'
    themeDistribution[theme] = (themeDistribution[theme] || 0) + 1
  }

  // Best for recommendations
  const bestFor: Record<string, string> = {}
  
  // Find brand with most vibrant colors
  const mostVibrant = comparisons.reduce((best, current) => {
    const currentVibrancy = calculateVibrancy(current.colors)
    const bestVibrancy = calculateVibrancy(best.colors)
    return currentVibrancy > bestVibrancy ? current : best
  })
  bestFor.creative = mostVibrant.brand

  // Find brand with most professional look
  const mostProfessional = comparisons.find(c => 
    c.colors.primary?.includes('000') || c.colors.primary?.includes('1a')
  ) || comparisons[0]
  bestFor.professional = mostProfessional.brand

  return {
    totalBrands: comparisons.length,
    commonColors,
    uniqueFonts: Array.from(fonts),
    themeDistribution,
    bestFor
  }
}

function calculateVibrancy(colors: ColorPalette): number {
  const values = Object.values(colors).filter(Boolean) as string[]
  if (values.length === 0) return 0

  let totalVibrancy = 0
  for (const color of values) {
    const rgb = hexToRgb(color)
    if (rgb) {
      const saturation = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      totalVibrancy += saturation
    }
  }

  return totalVibrancy / values.length
}

function detectTheme(primaryColor: string): string {
  const darkColors = ['#000', '#111', '#1a1a1a', '#0f0f0f']
  const lightColors = ['#fff', '#fafafa', '#f5f5f5', '#ffffff']
  
  if (darkColors.some(c => primaryColor.toLowerCase().includes(c))) return 'dark'
  if (lightColors.some(c => primaryColor.toLowerCase().includes(c))) return 'light'
  return 'colorful'
}

function generateRecommendations(comparisons: BrandComparison[], summary: ComparisonSummary): string[] {
  const recommendations: string[] = []

  if (comparisons.length >= 2) {
    recommendations.push(`Consider blending elements from ${comparisons[0].brand} and ${comparisons[1].brand} for a unique design`)
  }

  if (summary.commonColors.length > 0) {
    recommendations.push(`Common colors across brands: ${summary.commonColors.join(', ')} - these are safe choices`)
  }

  if (summary.uniqueFonts.length > 3) {
    recommendations.push('High typographic diversity detected - consider standardizing on 2-3 font families')
  }

  const themes = Object.keys(summary.themeDistribution)
  if (themes.includes('dark') && themes.includes('light')) {
    recommendations.push('Both dark and light themes available - implement theme switching')
  }

  return recommendations
}

function generateMigrationGuide(from: DesignSystem, to: DesignSystem): string {
  const lines: string[] = []

  lines.push(`# Migration Guide: ${from.brand} → ${to.brand}`)
  lines.push('')
  lines.push('## Color Mapping')
  lines.push('')

  // Map colors
  for (const [fromName, fromValue] of Object.entries(from.colors)) {
    if (!fromValue) continue
    
    const toEntry = Object.entries(to.colors).find(([, v]) => 
      v && colorDistance(fromValue, v) < 100
    )
    
    if (toEntry) {
      lines.push(`- ${fromName}: ${fromValue} → ${toEntry[0]}: ${toEntry[1]}`)
    } else {
      lines.push(`- ${fromName}: ${fromValue} → (no direct match, custom mapping needed)`)
    }
  }

  lines.push('')
  lines.push('## Typography Changes')
  lines.push('')

  if (from.typography.fontFamily !== to.typography.fontFamily) {
    lines.push(`- Font Family: "${from.typography.fontFamily}" → "${to.typography.fontFamily}"`)
  }

  lines.push('')
  lines.push('## Component Updates')
  lines.push('')
  lines.push('Review component styles and update class names to match the new design system.')

  return lines.join('\n')
}
