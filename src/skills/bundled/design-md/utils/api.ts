/**
 * Design-MD API Client
 * Handles all external API calls to the getdesign.md service
 * Uses native fetch (Bun compatible)
 */

import type { DesignSystem, FetchInput, FetchOutput } from '../types'

const BASE_URL = 'https://getdesign.md'

/**
 * Fetch a design system from the awesome-design-md collection
 */
export async function fetchDesignSystem(input: FetchInput): Promise<FetchOutput> {
  const { brand, format = 'json', theme = 'light' } = input
  
  try {
    const normalizedBrand = normalizeBrandName(brand)
    const url = `${BASE_URL}/${normalizedBrand}/design-md`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Claude-Code-Design-MD-Skill/1.0',
        'Accept': 'text/markdown, application/json, text/html'
      }
    })

    if (response.status === 404) {
      return {
        success: false,
        brand: normalizedBrand,
        data: '',
        format,
        error: `Design system not found for: ${brand}. Use /design-md list to see available brands.`
      }
    }

    if (response.status !== 200) {
      return {
        success: false,
        brand: normalizedBrand,
        data: '',
        format,
        error: `Failed to fetch design system: HTTP ${response.status}`
      }
    }

    const content = await response.text()
    const previewUrl = `${BASE_URL}/${normalizedBrand}/preview${theme === 'dark' ? '-dark' : ''}.html`

    if (format === 'json') {
      const parsed = parseDesignSystem(content, normalizedBrand)
      return {
        success: true,
        brand: normalizedBrand,
        data: parsed,
        format,
        previewUrl
      }
    }

    return {
      success: true,
      brand: normalizedBrand,
      data: content,
      format,
      previewUrl
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      brand,
      data: '',
      format,
      error: `Network error: ${message}`
    }
  }
}

/**
 * Parse design system markdown content into structured data
 */
function parseDesignSystem(content: string, brand: string): DesignSystem {
  const sections: Record<string, string[]> = {}
  let currentSection = ''

  const sectionPatterns = [
    { key: 'theme', patterns: ['Visual Theme', 'Atmosphere', 'Philosophy'] },
    { key: 'colors', patterns: ['Color Palette', 'Colors', 'Palette'] },
    { key: 'typography', patterns: ['Typography', 'Fonts', 'Text'] },
    { key: 'components', patterns: ['Components', 'UI Elements', 'Elements'] },
    { key: 'layout', patterns: ['Layout', 'Grid', 'Spacing'] },
    { key: 'depth', patterns: ['Depth', 'Elevation', 'Shadows'] },
    { key: 'guidelines', patterns: ["Do's and Don'ts", 'Guidelines', 'Rules'] },
    { key: 'responsive', patterns: ['Responsive', 'Mobile', 'Breakpoints'] },
    { key: 'prompts', patterns: ['Prompt', 'Agent', 'AI'] }
  ]

  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    const detectedSection = sectionPatterns.find(pattern =>
      pattern.patterns.some(p =>
        trimmed.toLowerCase().includes(p.toLowerCase()) &&
        (trimmed.startsWith('#') || trimmed.startsWith('##') || trimmed.startsWith('###'))
      )
    )

    if (detectedSection) {
      currentSection = detectedSection.key
      sections[currentSection] = []
    } else if (currentSection && trimmed) {
      sections[currentSection].push(trimmed)
    }
  }

  return {
    brand,
    url: `${BASE_URL}/${brand}/design-md`,
    theme: extractTheme(sections.theme || []),
    colors: extractColors(sections.colors || []),
    typography: extractTypography(sections.typography || []),
    components: extractComponents(sections.components || []),
    layout: extractLayout(sections.layout || []),
    guidelines: sections.guidelines || [],
    responsive: extractResponsive(sections.responsive || []),
    raw: sections
  }
}

function extractTheme(themeSection: string[]): DesignSystem['theme'] {
  const text = themeSection.join(' ')
  return {
    description: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
    keywords: extractKeywords(text),
    mood: detectMood(text)
  }
}

function extractColors(colorSection: string[]): DesignSystem['colors'] {
  const colors: DesignSystem['colors'] = {}
  const text = colorSection.join('\n')

  // Look for color definitions like "Primary: #007AFF"
  const lines = colorSection
  for (const line of lines) {
    const colorMatch = line.match(/([a-zA-Z][a-zA-Z0-9\s-]*?):\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgb\([^)]+\)|hsl\([^)]+\))/i)
    if (colorMatch) {
      const name = colorMatch[1].trim().toLowerCase().replace(/\s+/g, '-')
      colors[name] = colorMatch[2].trim()
    }
  }

  // Fallback: extract all colors found in text
  const hexPattern = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})/g
  const allColors = [...text.matchAll(hexPattern)].map(m => m[0])
  if (Object.keys(colors).length === 0 && allColors.length > 0) {
    colors.primary = allColors[0]
    if (allColors.length > 1) colors.secondary = allColors[1]
    if (allColors.length > 2) colors.accent = allColors[2]
  }

  return colors
}

function extractTypography(typoSection: string[]): DesignSystem['typography'] {
  const typography: DesignSystem['typography'] = {}
  const text = typoSection.join('\n')

  const fontMatch = text.match(/font-family:\s*([^;\n]+)/i)
  if (fontMatch) {
    typography.fontFamily = fontMatch[1].trim().replace(/['"]/g, '')
  }

  const sizeMatches = [...text.matchAll(/(\w+):\s*(\d+(?:\.\d+)?(?:px|rem|em|%))/gi)]
  if (sizeMatches.length > 0) {
    typography.sizes = {}
    for (const [_, name, size] of sizeMatches) {
      typography.sizes[name.toLowerCase()] = size
    }
  }

  const lineHeightMatch = text.match(/line-height:\s*([^;\n]+)/i)
  if (lineHeightMatch) {
    typography.lineHeight = lineHeightMatch[1].trim()
  }

  const weightMatches = [...text.matchAll(/font-weight:\s*(\d+|\w+)/gi)]
  if (weightMatches.length > 0) {
    typography.weights = weightMatches.map(m => m[1])
  }

  return typography
}

function extractComponents(componentSection: string[]): DesignSystem['components'] {
  const components: DesignSystem['components'] = []
  const text = componentSection.join('\n')

  const componentPatterns = [
    { name: 'button', pattern: /(?:button|btn)[\s:]*(.*?)(?=\n|$)/gi },
    { name: 'card', pattern: /(?:card|container)[\s:]*(.*?)(?=\n|$)/gi },
    { name: 'input', pattern: /(?:input|form)[\s:]*(.*?)(?=\n|$)/gi },
    { name: 'navigation', pattern: /(?:nav|navigation)[\s:]*(.*?)(?=\n|$)/gi },
    { name: 'modal', pattern: /(?:modal|dialog)[\s:]*(.*?)(?=\n|$)/gi },
    { name: 'badge', pattern: /(?:badge|tag)[\s:]*(.*?)(?=\n|$)/gi }
  ]

  for (const { name, pattern } of componentPatterns) {
    const matches = [...text.matchAll(pattern)]
    for (const match of matches) {
      components.push({
        name,
        description: match[1]?.trim() || `${name} component styling`
      })
    }
  }

  return components
}

function extractLayout(layoutSection: string[]): DesignSystem['layout'] {
  const layout: DesignSystem['layout'] = {}
  const text = layoutSection.join('\n')

  const spacingMatch = text.match(/spacing:\s*([^;\n]+)/i)
  if (spacingMatch) {
    layout.spacing = spacingMatch[1].trim()
  }

  const gridMatch = text.match(/grid:\s*([^;\n]+)/i)
  if (gridMatch) {
    layout.grid = gridMatch[1].trim()
  }

  const bpMatches = [...text.matchAll(/(\w+):\s*(\d+px)/gi)]
  if (bpMatches.length > 0) {
    layout.breakpoints = {}
    for (const [_, name, size] of bpMatches) {
      layout.breakpoints[name.toLowerCase()] = size
    }
  }

  return layout
}

function extractResponsive(responsiveSection: string[]): DesignSystem['responsive'] {
  const responsive: DesignSystem['responsive'] = {}
  const text = responsiveSection.join('\n')

  const patterns = [
    { key: 'mobile', pattern: /mobile[:\s]+(\d+px)/i },
    { key: 'tablet', pattern: /tablet[:\s]+(\d+px)/i },
    { key: 'desktop', pattern: /desktop[:\s]+(\d+px)/i },
    { key: 'wide', pattern: /wide[:\s]+(\d+px)/i }
  ]

  for (const { key, pattern } of patterns) {
    const match = text.match(pattern)
    if (match) {
      responsive[key as keyof typeof responsive] = match[1]
    }
  }

  return responsive
}

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/)
  const keywords = words.filter(word =>
    word.length > 3 &&
    !['the', 'and', 'with', 'for', 'from', 'that', 'this', 'have'].includes(word)
  )
  return [...new Set(keywords)].slice(0, 10)
}

function detectMood(text: string): DesignSystem['theme']['mood'] {
  const moodKeywords = {
    modern: ['modern', 'clean', 'minimal', 'sleek', 'contemporary'],
    professional: ['professional', 'corporate', 'enterprise', 'business', 'formal'],
    playful: ['playful', 'fun', 'vibrant', 'colorful', 'friendly'],
    elegant: ['elegant', 'luxury', 'premium', 'sophisticated', 'refined'],
    tech: ['tech', 'technical', 'engineering', 'data-driven', 'innovative']
  }

  const textLower = text.toLowerCase()
  const scores: Record<string, number> = {}

  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    scores[mood] = keywords.filter(keyword => textLower.includes(keyword)).length
  }

  const bestMood = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return (bestMood && bestMood[1] > 0 ? bestMood[0] : 'neutral') as DesignSystem['theme']['mood']
}

export function normalizeBrandName(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function getBrandUrl(brand: string): string {
  return `${BASE_URL}/${normalizeBrandName(brand)}/design-md`
}

export function getPreviewUrl(brand: string, theme: 'light' | 'dark' = 'light'): string {
  return `${BASE_URL}/${normalizeBrandName(brand)}/preview${theme === 'dark' ? '-dark' : ''}.html`
}
