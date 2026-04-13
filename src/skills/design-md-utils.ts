// Use native fetch (Bun compatible)
const BASE_URL = 'https://getdesign.md'

// Complete brand categorization from awesome-design-md
export const BRAND_CATEGORIES = {
  'ai-platforms': {
    name: 'AI & LLM Platforms',
    brands: ['claude', 'cohere', 'elevenlabs', 'minimax', 'mistral-ai', 'ollama', 'opencode-ai', 'replicate', 'runwayml', 'together-ai', 'voltagent', 'xai'],
    description: 'AI interface patterns, dark themes, technical dashboards'
  },
  'dev-tools': {
    name: 'Developer Tools & IDEs',
    brands: ['cursor', 'expo', 'lovable', 'raycast', 'superhuman', 'vercel', 'warp'],
    description: 'Development workflow interfaces, dark coding themes'
  },
  'backend-devops': {
    name: 'Backend, Database & DevOps',
    brands: ['clickhouse', 'composio', 'hashicorp', 'mongodb', 'posthog', 'sanity', 'sentry', 'supabase'],
    description: 'Infrastructure monitoring, data dashboards, enterprise styling'
  },
  'productivity-saas': {
    name: 'Productivity & SaaS',
    brands: ['cal.com', 'intercom', 'linear', 'mintlify', 'notion', 'resend', 'zapier'],
    description: 'Workflow optimization, clean documentation, scheduling'
  },
  'design-creative': {
    name: 'Design & Creative Tools',
    brands: ['airtable', 'clay', 'figma', 'framer', 'miro', 'webflow'],
    description: 'Creative interfaces, collaboration patterns, visual tools'
  },
  'fintech': {
    name: 'Fintech & Crypto',
    brands: ['binance', 'coinbase', 'kraken', 'revolut', 'stripe', 'wise'],
    description: 'Financial dashboards, payment flows, trust-focused design'
  },
  'ecommerce': {
    name: 'E-commerce & Retail',
    brands: ['airbnb', 'meta', 'nike', 'shopify', 'the-verge'],
    description: 'Product showcases, booking flows, retail photography'
  },
  'consumer-tech': {
    name: 'Media & Consumer Tech',
    brands: ['apple', 'ibm', 'nvidia', 'pinterest', 'playstation', 'spacex', 'spotify', 'the-verge', 'uber', 'wired'],
    description: 'Consumer applications, media interfaces, premium aesthetics'
  },
  'automotive': {
    name: 'Automotive',
    brands: ['bmw', 'bugatti', 'ferrari', 'lamborghini', 'renault', 'tesla'],
    description: 'Luxury branding, automotive photography, premium feel'
  }
}

export async function fetchDesignSystem(brand: string, format: 'markdown' | 'json' | 'html' = 'markdown', theme: 'light' | 'dark' = 'light') {
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
      throw new Error(`Design system not found for: ${brand}. Use /design-md list to see available brands.`)
    }

    if (response.status !== 200) {
      throw new Error(`Failed to fetch design system: HTTP ${response.status}`)
    }

    const content = await response.text()

    if (format === 'json') {
      return {
        success: true,
        brand: normalizedBrand,
        url,
        format,
        theme,
        ...parseDesignSystem(content, normalizedBrand),
        previewUrl: `${BASE_URL}/${normalizedBrand}/preview${theme === 'dark' ? '-dark' : ''}.html`
      }
    }

    return {
      success: true,
      brand: normalizedBrand,
      url,
      format,
      theme,
      data: content,
      previewUrl: `${BASE_URL}/${normalizedBrand}/preview${theme === 'dark' ? '-dark' : ''}.html`
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      throw new Error(`Design system for "${brand}" not found. Available brands: ${getAllBrands().slice(0, 10).join(', ')}...`)
    }
    throw new Error(`Network error: ${error.message}`)
  }
}

export function parseDesignSystem(content: string, brand: string) {
  const sections = {}
  let currentSection = ''

  // Google's Stitch format sections
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
  const sectionContent = {}

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect section headers
    const detectedSection = sectionPatterns.find(pattern =>
      pattern.patterns.some(p =>
        trimmed.toLowerCase().includes(p.toLowerCase()) &&
        (trimmed.startsWith('#') || trimmed.startsWith('##') || trimmed.startsWith('###'))
      )
    )

    if (detectedSection) {
      currentSection = detectedSection.key
      sectionContent[currentSection] = []
    } else if (currentSection && trimmed) {
      sectionContent[currentSection].push(trimmed)
    }
  }

  return {
    data: {
      brand,
      theme: extractTheme(sectionContent.theme || []),
      colors: extractColors(sectionContent.colors || []),
      typography: extractTypography(sectionContent.typography || []),
      components: extractComponents(sectionContent.components || []),
      layout: extractLayout(sectionContent.layout || []),
      guidelines: sectionContent.guidelines || [],
      responsive: sectionContent.responsive || [],
      raw: sectionContent
    }
  }
}

function extractTheme(themeSection: string[]) {
  const text = themeSection.join(' ')
  return {
    description: text.substring(0, 200) + '...',
    keywords: extractKeywords(text),
    mood: detectMood(text)
  }
}

function extractColors(colorSection: string[]) {
  const colors = {}
  const text = colorSection.join('\n')

  // Hex color patterns
  const hexPattern = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})/g
  const rgbPattern = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g
  const hslPattern = /hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/g

  // Extract colors with names
  const lines = colorSection
  for (const line of lines) {
    // Look for color definitions like "Primary: #007AFF" or "background: #ffffff"
    const colorMatch = line.match(/([a-zA-Z][a-zA-Z0-9\s-]*?):\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgb\([^)]+\)|hsl\([^)]+\))/i)
    if (colorMatch) {
      const name = colorMatch[1].trim().toLowerCase().replace(/\s+/g, '-')
      colors[name] = colorMatch[2].trim()
    }
  }

  // Fallback: extract all colors found in text
  const allColors = [...text.matchAll(hexPattern)].map(m => m[0])
  if (Object.keys(colors).length === 0 && allColors.length > 0) {
    colors.primary = allColors[0]
    if (allColors.length > 1) colors.secondary = allColors[1]
    if (allColors.length > 2) colors.accent = allColors[2]
  }

  return colors
}

function extractTypography(typoSection: string[]) {
  const typography = {}
  const text = typoSection.join('\n')

  // Extract font family
  const fontMatch = text.match(/font-family:\s*([^;\n]+)/i)
  if (fontMatch) {
    typography.fontFamily = fontMatch[1].trim().replace(/['"]/g, '')
  }

  // Extract font sizes
  const sizeMatches = [...text.matchAll(/(\w+):\s*(\d+(?:\.\d+)?(?:px|rem|em|%))/gi)]
  if (sizeMatches.length > 0) {
    typography.sizes = {}
    for (const [_, name, size] of sizeMatches) {
      typography.sizes[name.toLowerCase()] = size
    }
  }

  // Extract line heights
  const lineHeightMatch = text.match(/line-height:\s*([^;\n]+)/i)
  if (lineHeightMatch) {
    typography.lineHeight = lineHeightMatch[1].trim()
  }

  // Extract font weights
  const weightMatches = [...text.matchAll(/font-weight:\s*(\d+|\w+)/gi)]
  if (weightMatches.length > 0) {
    typography.weights = weightMatches.map(m => m[1])
  }

  return typography
}

function extractComponents(componentSection: string[]) {
  const components = []
  const text = componentSection.join('\n')

  // Common component patterns
  const componentPatterns = [
    /(?:button|btn)[\s:]*(.*?)(?=\n|$)/gi,
    /(?:card|container)[\s:]*(.*?)(?=\n|$)/gi,
    /(?:input|form)[\s:]*(.*?)(?=\n|$)/gi,
    /(?:nav|navigation)[\s:]*(.*?)(?=\n|$)/gi,
    /(?:modal|dialog)[\s:]*(.*?)(?=\n|$)/gi,
    /(?:badge|tag)[\s:]*(.*?)(?=\n|$)/gi
  ]

  for (const pattern of componentPatterns) {
    const matches = [...text.matchAll(pattern)]
    for (const match of matches) {
      components.push({
        name: pattern.toString().match(/(?:button|card|input|nav|modal|badge)/i)[0],
        description: match[1]?.trim() || 'Component styling details'
      })
    }
  }

  return components
}

function extractLayout(layoutSection: string[]) {
  const layout = {}
  const text = layoutSection.join('\n')

  // Extract spacing
  const spacingMatch = text.match(/spacing:\s*([^;\n]+)/i)
  if (spacingMatch) {
    layout.spacing = spacingMatch[1].trim()
  }

  // Extract grid
  const gridMatch = text.match(/grid:\s*([^;\n]+)/i)
  if (gridMatch) {
    layout.grid = gridMatch[1].trim()
  }

  // Extract breakpoints
  const bpMatches = [...text.matchAll(/(\w+):\s*(\d+px)/gi)]
  if (bpMatches.length > 0) {
    layout.breakpoints = {}
    for (const [_, name, size] of bpMatches) {
      layout.breakpoints[name.toLowerCase()] = size
    }
  }

  return layout
}

function extractKeywords(text: string) {
  const words = text.toLowerCase().split(/\s+/)
  const keywords = words.filter(word =>
    word.length > 3 &&
    !['the', 'and', 'with', 'for', 'from', 'that', 'this'].includes(word)
  )
  return [...new Set(keywords)].slice(0, 10)
}

function detectMood(text: string) {
  const moodKeywords = {
    modern: ['modern', 'clean', 'minimal', 'sleek'],
    professional: ['professional', 'corporate', 'enterprise', 'business'],
    playful: ['playful', 'fun', 'vibrant', 'colorful'],
    elegant: ['elegant', 'luxury', 'premium', 'sophisticated'],
    tech: ['tech', 'technical', 'engineering', 'data-driven']
  }

  const textLower = text.toLowerCase()
  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return mood
    }
  }
  return 'neutral'
}

export function getAllBrands(): string[] {
  return Object.values(BRAND_CATEGORIES).flatMap(category => category.brands)
}

export function categorizeBrands() {
  const categorized = {}

  for (const [key, category] of Object.entries(BRAND_CATEGORIES)) {
    categorized[key] = {
      ...category,
      count: category.brands.length,
      urls: category.brands.map(brand => ({
        name: brand,
        designUrl: getBrandUrl(brand),
        previewUrl: getPreviewUrl(brand)
      }))
    }
  }

  return categorized
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

export function searchBrands(query: string, category?: string) {
  const allBrands = getAllBrands()
  let results = allBrands

  if (query) {
    results = results.filter(brand =>
      brand.toLowerCase().includes(query.toLowerCase())
    )
  }

  if (category) {
    const normalizedCategory = category.toLowerCase()
    results = results.filter(brand => {
      for (const [catKey, catData] of Object.entries(BRAND_CATEGORIES)) {
        if (catKey.toLowerCase().includes(normalizedCategory) && catData.brands.includes(brand)) {
          return true
        }
      }
      return false
    })
  }

  return {
    results,
    total: results.length,
    categories: category ? [category] : Object.keys(BRAND_CATEGORIES)
  }
}

export const designSystemUtils = {
  getAllBrands,
  categorizeBrands,
  normalizeBrandName,
  getBrandUrl,
  getPreviewUrl,
  searchBrands,
  BRAND_CATEGORIES,
  BASE_URL
}