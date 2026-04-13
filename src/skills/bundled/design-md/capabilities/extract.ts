/**
 * Extract Capability - Data Extraction and Export
 * 
 * Provides atomic capability for extracting specific design elements
 * and exporting to various formats.
 */

import type { 
  ExtractCapability, 
  ExtractInput, 
  ExtractOutput,
  DesignSystem,
  ColorPalette,
  TypographySystem,
  ComponentInfo
} from '../types'
import { fetchCapability } from './fetch'

export const extractCapability: ExtractCapability = {
  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const { brand, extractType, format = 'json' } = input

    try {
      const result = await fetchCapability.get({ brand, format: 'json' })
      
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          brand,
          extracted: null,
          format,
          error: result.error || 'Failed to fetch design system'
        }
      }

      const system = result.data as DesignSystem
      let extracted: unknown

      switch (extractType) {
        case 'colors':
          extracted = format === 'css' 
            ? extractColorsToCSS(system.colors)
            : system.colors
          break
        case 'typography':
          extracted = format === 'css'
            ? extractTypographyToCSS(system.typography)
            : system.typography
          break
        case 'components':
          extracted = system.components
          break
        case 'full':
        default:
          extracted = format === 'figma-tokens'
            ? convertToFigmaTokens(system)
            : system
      }

      return {
        success: true,
        brand,
        extracted,
        format
      }
    } catch (error) {
      return {
        success: false,
        brand,
        extracted: null,
        format,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async exportToFormat(system: DesignSystem, format: 'figma' | 'sketch' | 'xd'): Promise<unknown> {
    switch (format) {
      case 'figma':
        return convertToFigmaFormat(system)
      case 'sketch':
        return convertToSketchFormat(system)
      case 'xd':
        return convertToXDFormat(system)
      default:
        throw new Error(`Unsupported export format: ${format}`)
    }
  }
}

function extractColorsToCSS(colors: ColorPalette): string {
  const lines: string[] = []
  lines.push(':root {')
  
  for (const [name, value] of Object.entries(colors)) {
    if (value) {
      lines.push(`  --color-${name}: ${value};`)
    }
  }
  
  lines.push('}')
  return lines.join('\n')
}

function extractTypographyToCSS(typography: TypographySystem): string {
  const lines: string[] = []
  lines.push(':root {')
  
  if (typography.fontFamily) {
    lines.push(`  --font-family: ${typography.fontFamily};`)
  }
  if (typography.lineHeight) {
    lines.push(`  --line-height: ${typography.lineHeight};`)
  }
  
  if (typography.sizes) {
    for (const [name, value] of Object.entries(typography.sizes)) {
      lines.push(`  --font-size-${name}: ${value};`)
    }
  }
  
  lines.push('}')
  return lines.join('\n')
}

function convertToFigmaTokens(system: DesignSystem): Record<string, unknown> {
  const tokens: Record<string, unknown> = {
    version: '1.0',
    brand: system.brand,
    tokens: {}
  }

  // Colors
  if (system.colors) {
    tokens.tokens.colors = {}
    for (const [name, value] of Object.entries(system.colors)) {
      if (value) {
        tokens.tokens.colors[name] = {
          value: value,
          type: 'color'
        }
      }
    }
  }

  // Typography
  if (system.typography) {
    tokens.tokens.typography = {}
    if (system.typography.fontFamily) {
      tokens.tokens.typography.fontFamily = {
        value: system.typography.fontFamily,
        type: 'fontFamilies'
      }
    }
    if (system.typography.sizes) {
      for (const [name, value] of Object.entries(system.typography.sizes)) {
        tokens.tokens.typography[name] = {
          value: value,
          type: 'fontSizes'
        }
      }
    }
  }

  return tokens
}

function convertToFigmaFormat(system: DesignSystem): Record<string, unknown> {
  return {
    document: {
      name: `${system.brand} Design System`,
      type: 'DOCUMENT',
      children: [
        {
          name: 'Colors',
          type: 'CANVAS',
          children: generateFigmaColorStyles(system.colors)
        },
        {
          name: 'Typography',
          type: 'CANVAS',
          children: generateFigmaTypographyStyles(system.typography)
        }
      ]
    }
  }
}

function generateFigmaColorStyles(colors: ColorPalette): unknown[] {
  return Object.entries(colors)
    .filter(([, value]) => value)
    .map(([name, value], index) => ({
      name: `Colors/${name}`,
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', color: hexToFigmaColor(value as string) }],
      absoluteBoundingBox: { x: 0, y: index * 50, width: 200, height: 40 }
    }))
}

function generateFigmaTypographyStyles(typography: TypographySystem): unknown[] {
  if (!typography.sizes) return []
  
  return Object.entries(typography.sizes).map(([name, value], index) => ({
    name: `Typography/${name}`,
    type: 'TEXT',
    characters: `${name} - Sample Text`,
    style: {
      fontFamily: typography.fontFamily || 'Inter',
      fontSize: parseInt(value) || 16
    },
    absoluteBoundingBox: { x: 0, y: index * 60, width: 300, height: 50 }
  }))
}

function hexToFigmaColor(hex: string): { r: number; g: number; b: number } {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 }
  return {
    r: rgb.r / 255,
    g: rgb.g / 255,
    b: rgb.b / 255
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

function convertToSketchFormat(system: DesignSystem): Record<string, unknown> {
  return {
    version: 136,
    page: {
      name: `${system.brand} Design System`,
      layers: [
        ...generateSketchColorLayers(system.colors),
        ...generateSketchTextLayers(system.typography)
      ]
    }
  }
}

function generateSketchColorLayers(colors: ColorPalette): unknown[] {
  return Object.entries(colors)
    .filter(([, value]) => value)
    .map(([name, value], index) => ({
      name,
      type: 'rectangle',
      frame: { x: 0, y: index * 50, width: 200, height: 40 },
      style: {
        fills: [{ color: value }]
      }
    }))
}

function generateSketchTextLayers(typography: TypographySystem): unknown[] {
  if (!typography.sizes) return []
  
  return Object.entries(typography.sizes).map(([name, value], index) => ({
    name: `${name} Sample`,
    type: 'text',
    frame: { x: 220, y: index * 60, width: 300, height: 50 },
    text: `${name} - Sample Text`,
    style: {
      fontFamily: typography.fontFamily || 'SF Pro',
      fontSize: parseInt(value) || 16
    }
  }))
}

function convertToXDFormat(system: DesignSystem): Record<string, unknown> {
  return {
    version: '4.0',
    name: `${system.brand} Design System`,
    resources: {
      colors: Object.entries(system.colors || {})
        .filter(([, value]) => value)
        .map(([name, value]) => ({
          name,
          value
        })),
      characterStyles: Object.entries(system.typography?.sizes || {})
        .map(([name, value]) => ({
          name,
          font: {
            family: system.typography?.fontFamily || 'Arial',
            size: parseInt(value) || 16
          }
        }))
    }
  }
}
