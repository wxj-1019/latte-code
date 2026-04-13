/**
 * Brand Catalog and Category Definitions
 * Complete brand categorization from awesome-design-md collection
 */

import type { CategoryInfo, BrandInfo } from '../types'
import { getBrandUrl, getPreviewUrl, normalizeBrandName } from './api'

export const BRAND_CATEGORIES: Record<string, Omit<CategoryInfo, 'count'>> = {
  'ai-platforms': {
    id: 'ai-platforms',
    name: 'AI & LLM Platforms',
    brands: ['claude', 'cohere', 'elevenlabs', 'minimax', 'mistral-ai', 'ollama', 'opencode-ai', 'replicate', 'runwayml', 'together-ai', 'voltagent', 'xai'],
    description: 'AI interface patterns, dark themes, technical dashboards'
  },
  'dev-tools': {
    id: 'dev-tools',
    name: 'Developer Tools & IDEs',
    brands: ['cursor', 'expo', 'lovable', 'raycast', 'superhuman', 'vercel', 'warp'],
    description: 'Development workflow interfaces, dark coding themes'
  },
  'backend-devops': {
    id: 'backend-devops',
    name: 'Backend, Database & DevOps',
    brands: ['clickhouse', 'composio', 'hashicorp', 'mongodb', 'posthog', 'sanity', 'sentry', 'supabase'],
    description: 'Infrastructure monitoring, data dashboards, enterprise styling'
  },
  'productivity-saas': {
    id: 'productivity-saas',
    name: 'Productivity & SaaS',
    brands: ['cal.com', 'intercom', 'linear', 'mintlify', 'notion', 'resend', 'zapier'],
    description: 'Workflow optimization, clean documentation, scheduling'
  },
  'design-creative': {
    id: 'design-creative',
    name: 'Design & Creative Tools',
    brands: ['airtable', 'clay', 'figma', 'framer', 'miro', 'webflow'],
    description: 'Creative interfaces, collaboration patterns, visual tools'
  },
  'fintech': {
    id: 'fintech',
    name: 'Fintech & Crypto',
    brands: ['binance', 'coinbase', 'kraken', 'revolut', 'stripe', 'wise'],
    description: 'Financial dashboards, payment flows, trust-focused design'
  },
  'ecommerce': {
    id: 'ecommerce',
    name: 'E-commerce & Retail',
    brands: ['airbnb', 'meta', 'nike', 'shopify', 'the-verge'],
    description: 'Product showcases, booking flows, retail photography'
  },
  'consumer-tech': {
    id: 'consumer-tech',
    name: 'Media & Consumer Tech',
    brands: ['apple', 'ibm', 'nvidia', 'pinterest', 'playstation', 'spacex', 'spotify', 'the-verge', 'uber', 'wired'],
    description: 'Consumer applications, media interfaces, premium aesthetics'
  },
  'automotive': {
    id: 'automotive',
    name: 'Automotive',
    brands: ['bmw', 'bugatti', 'ferrari', 'lamborghini', 'renault', 'tesla'],
    description: 'Luxury branding, automotive photography, premium feel'
  }
}

export function getAllBrands(): string[] {
  return Object.values(BRAND_CATEGORIES).flatMap(category => category.brands)
}

export function getAllCategories(): CategoryInfo[] {
  return Object.values(BRAND_CATEGORIES).map(category => ({
    ...category,
    count: category.brands.length
  }))
}

export function getCategoryById(id: string): CategoryInfo | undefined {
  const category = BRAND_CATEGORIES[id]
  if (!category) return undefined
  return {
    ...category,
    count: category.brands.length
  }
}

export function findBrandCategory(brand: string): string | undefined {
  const normalizedBrand = normalizeBrandName(brand)
  for (const [categoryId, category] of Object.entries(BRAND_CATEGORIES)) {
    if (category.brands.some(b => normalizeBrandName(b) === normalizedBrand)) {
      return categoryId
    }
  }
  return undefined
}

export function searchBrands(query: string, categoryId?: string): BrandInfo[] {
  const normalizedQuery = query.toLowerCase()
  const results: BrandInfo[] = []

  for (const [id, category] of Object.entries(BRAND_CATEGORIES)) {
    if (categoryId && id !== categoryId) continue

    for (const brand of category.brands) {
      if (brand.toLowerCase().includes(normalizedQuery)) {
        results.push({
          name: brand,
          category: category.name,
          description: category.description,
          designUrl: getBrandUrl(brand),
          previewUrl: getPreviewUrl(brand)
        })
      }
    }
  }

  return results
}

export function getBrandInfo(brand: string): BrandInfo | undefined {
  const normalizedBrand = normalizeBrandName(brand)
  
  for (const [id, category] of Object.entries(BRAND_CATEGORIES)) {
    const foundBrand = category.brands.find(b => normalizeBrandName(b) === normalizedBrand)
    if (foundBrand) {
      return {
        name: foundBrand,
        category: category.name,
        description: category.description,
        designUrl: getBrandUrl(foundBrand),
        previewUrl: getPreviewUrl(foundBrand)
      }
    }
  }
  
  return undefined
}

export function getBrandsByCategory(categoryId: string): BrandInfo[] {
  const category = BRAND_CATEGORIES[categoryId]
  if (!category) return []

  return category.brands.map(brand => ({
    name: brand,
    category: category.name,
    description: category.description,
    designUrl: getBrandUrl(brand),
    previewUrl: getPreviewUrl(brand)
  }))
}
