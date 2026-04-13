/**
 * Generate Capability - Code Generation
 * 
 * Provides atomic capability for generating frontend code from design systems
 * including CSS variables, Tailwind configs, SCSS, and styled-components.
 */

import type { 
  GenerateCapability, 
  GenerateInput, 
  GenerateOutput,
  DesignSystem,
  GenerateOptions
} from '../types'
import { fetchCapability } from './fetch'

export const generateCapability: GenerateCapability = {
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const { brand, outputType, options = {} } = input

    try {
      const result = await fetchCapability.get({ brand, format: 'json' })
      
      if (!result.success || typeof result.data !== 'object') {
        return {
          success: false,
          brand,
          code: '',
          language: outputType,
          filename: getFilename(outputType)
        }
      }

      const system = result.data as DesignSystem
      let code: string
      let language: string
      let filename: string

      switch (outputType) {
        case 'css':
          code = this.generateCSS(system, options)
          language = 'css'
          filename = `${brand}-design-system.css`
          break
        case 'tailwind':
          code = this.generateTailwind(system, options)
          language = 'javascript'
          filename = `tailwind.config.js`
          break
        case 'scss':
          code = this.generateSCSS(system, options)
          language = 'scss'
          filename = `${brand}-design-system.scss`
          break
        case 'styled-components':
          code = generateStyledComponents(system, options)
          language = 'typescript'
          filename = `${brand}-theme.ts`
          break
        default:
          code = this.generateCSS(system, options)
          language = 'css'
          filename = `${brand}-design-system.css`
      }

      return {
        success: true,
        brand,
        code,
        language,
        filename
      }
    } catch (error) {
      return {
        success: false,
        brand,
        code: '',
        language: outputType,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  generateCSS(system: DesignSystem, options: GenerateOptions = {}): string {
    const { prefix = '' } = options
    const vars: string[] = []
    
    vars.push(`/* ${system.brand} Design System */`)
    vars.push(`/* Generated from awesome-design-md */`)
    vars.push('')
    vars.push(':root {')

    // Colors
    if (system.colors) {
      vars.push('  /* Colors */')
      for (const [name, value] of Object.entries(system.colors)) {
        if (value) {
          vars.push(`  ${prefix}--color-${name}: ${value};`)
        }
      }
      vars.push('')
    }

    // Typography
    if (system.typography) {
      vars.push('  /* Typography */')
      if (system.typography.fontFamily) {
        vars.push(`  ${prefix}--font-family: ${system.typography.fontFamily};`)
      }
      if (system.typography.lineHeight) {
        vars.push(`  ${prefix}--line-height: ${system.typography.lineHeight};`)
      }
      vars.push('')
    }

    // Font sizes
    if (system.typography?.sizes) {
      vars.push('  /* Font Sizes */')
      for (const [name, value] of Object.entries(system.typography.sizes)) {
        vars.push(`  ${prefix}--font-size-${name}: ${value};`)
      }
      vars.push('')
    }

    // Layout
    if (system.layout) {
      vars.push('  /* Layout */')
      if (system.layout.spacing) {
        vars.push(`  ${prefix}--spacing: ${system.layout.spacing};`)
      }
      if (system.layout.maxWidth) {
        vars.push(`  ${prefix}--max-width: ${system.layout.maxWidth};`)
      }
      vars.push('')
    }

    vars.push('}')

    // Utility classes if requested
    if (options.includeComponents) {
      vars.push('')
      vars.push('/* Utility Classes */')
      vars.push(generateUtilityClasses(system, prefix))
    }

    return vars.join('\n')
  },

  generateTailwind(system: DesignSystem, options: GenerateOptions = {}): string {
    const colors: Record<string, string> = {}
    const fontFamily: Record<string, string[]> = {}
    const fontSize: Record<string, string> = {}

    // Map colors
    if (system.colors) {
      for (const [name, value] of Object.entries(system.colors)) {
        if (value) colors[name] = value
      }
    }

    // Map typography
    if (system.typography?.fontFamily) {
      fontFamily.sans = [system.typography.fontFamily, 'system-ui', 'sans-serif']
    }

    if (system.typography?.sizes) {
      for (const [name, value] of Object.entries(system.typography.sizes)) {
        fontSize[name] = value
      }
    }

    const config = {
      theme: {
        extend: {
          colors,
          fontFamily,
          fontSize
        }
      }
    }

    return `/** @type {import('tailwindcss').Config} */
module.exports = ${JSON.stringify(config, null, 2)}`
  },

  generateSCSS(system: DesignSystem, options: GenerateOptions = {}): string {
    const { prefix = '' } = options
    const lines: string[] = []

    lines.push(`// ${system.brand} Design System`)
    lines.push(`// Generated from awesome-design-md`)
    lines.push('')

    // SCSS Variables
    lines.push('// Variables')
    if (system.colors) {
      for (const [name, value] of Object.entries(system.colors)) {
        if (value) {
          lines.push(`$${prefix}color-${name}: ${value};`)
        }
      }
    }
    lines.push('')

    // Mixins
    if (options.includeComponents) {
      lines.push('// Mixins')
      lines.push(generateSCSSMixins(system, prefix))
    }

    return lines.join('\n')
  }
}

function generateStyledComponents(system: DesignSystem, options: GenerateOptions): string {
  const lines: string[] = []
  
  lines.push(`// ${system.brand} Theme - Styled Components`)
  lines.push(`import styled from 'styled-components'`)
  lines.push('')

  // Theme object
  lines.push('export const theme = {')
  
  // Colors
  if (system.colors) {
    lines.push('  colors: {')
    for (const [name, value] of Object.entries(system.colors)) {
      if (value) {
        lines.push(`    ${name}: '${value}',`)
      }
    }
    lines.push('  },')
  }

  // Typography
  if (system.typography) {
    lines.push('  typography: {')
    if (system.typography.fontFamily) {
      lines.push(`    fontFamily: '${system.typography.fontFamily}',`)
    }
    if (system.typography.sizes) {
      lines.push('    sizes: {')
      for (const [name, value] of Object.entries(system.typography.sizes)) {
        lines.push(`      ${name}: '${value}',`)
      }
      lines.push('    },')
    }
    lines.push('  },')
  }

  lines.push('}')
  lines.push('')

  // Styled components
  if (options.includeComponents) {
    lines.push('// Styled Components')
    lines.push('')
    lines.push('export const Container = styled.div`')
    lines.push('  max-width: ${props => props.theme.layout?.maxWidth || "1200px"};')
    lines.push('  margin: 0 auto;')
    lines.push('`')
    lines.push('')
    lines.push('export const Text = styled.p`')
    lines.push('  color: ${props => props.theme.colors?.text || "inherit"};')
    lines.push('  font-family: ${props => props.theme.typography?.fontFamily || "inherit"};')
    lines.push('`')
  }

  return lines.join('\n')
}

function generateUtilityClasses(system: DesignSystem, prefix: string): string {
  const classes: string[] = []

  // Color utilities
  if (system.colors) {
    for (const name of Object.keys(system.colors)) {
      classes.push(`.${prefix}text-${name} {`)
      classes.push(`  color: var(${prefix}--color-${name});`)
      classes.push('}')
      classes.push(`.${prefix}bg-${name} {`)
      classes.push(`  background-color: var(${prefix}--color-${name});`)
      classes.push('}')
    }
  }

  return classes.join('\n')
}

function generateSCSSMixins(system: DesignSystem, prefix: string): string {
  const mixins: string[] = []

  mixins.push(`@mixin ${prefix}container {`)
  mixins.push(`  max-width: ${system.layout?.maxWidth || '1200px'};`)
  mixins.push('  margin: 0 auto;')
  mixins.push('}')
  mixins.push('')

  if (system.typography?.fontFamily) {
    mixins.push(`@mixin ${prefix}font-base {`)
    mixins.push(`  font-family: ${system.typography.fontFamily};`)
    mixins.push('}')
  }

  return mixins.join('\n')
}

function getFilename(outputType: string): string {
  switch (outputType) {
    case 'css': return 'design-system.css'
    case 'tailwind': return 'tailwind.config.js'
    case 'scss': return 'design-system.scss'
    case 'styled-components': return 'theme.ts'
    default: return 'design-system.css'
  }
}
