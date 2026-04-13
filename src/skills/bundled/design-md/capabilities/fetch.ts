/**
 * Fetch Capability - Design System Retrieval
 * 
 * Provides atomic capability for fetching design systems from the
 * awesome-design-md collection with various format and filtering options.
 */

import type { 
  FetchCapability, 
  FetchInput, 
  FetchOutput, 
  ColorPalette, 
  TypographySystem, 
  ComponentInfo,
  DesignSystem 
} from '../types'
import { fetchDesignSystem } from '../utils/api'

export const fetchCapability: FetchCapability = {
  async get(input: FetchInput): Promise<FetchOutput> {
    const result = await fetchDesignSystem(input)
    
    // Handle section filtering
    if (input.section && input.section !== 'all' && result.success && typeof result.data === 'object') {
      const system = result.data as DesignSystem
      const filtered: Partial<DesignSystem> = {
        brand: system.brand,
        url: system.url
      }

      switch (input.section) {
        case 'colors':
          filtered.colors = system.colors
          break
        case 'typography':
          filtered.typography = system.typography
          break
        case 'components':
          filtered.components = system.components
          break
        case 'layout':
          filtered.layout = system.layout
          break
      }

      return {
        ...result,
        data: filtered as DesignSystem
      }
    }

    return result
  },

  async getColors(brand: string): Promise<ColorPalette> {
    const result = await fetchDesignSystem({ brand, format: 'json' })
    if (!result.success || typeof result.data !== 'object') {
      throw new Error(`Failed to fetch colors for ${brand}: ${result.error}`)
    }
    return (result.data as DesignSystem).colors
  },

  async getTypography(brand: string): Promise<TypographySystem> {
    const result = await fetchDesignSystem({ brand, format: 'json' })
    if (!result.success || typeof result.data !== 'object') {
      throw new Error(`Failed to fetch typography for ${brand}: ${result.error}`)
    }
    return (result.data as DesignSystem).typography
  },

  async getComponents(brand: string): Promise<ComponentInfo[]> {
    const result = await fetchDesignSystem({ brand, format: 'json' })
    if (!result.success || typeof result.data !== 'object') {
      throw new Error(`Failed to fetch components for ${brand}: ${result.error}`)
    }
    return (result.data as DesignSystem).components
  }
}
