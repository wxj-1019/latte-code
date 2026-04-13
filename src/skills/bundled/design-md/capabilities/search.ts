/**
 * Search Capability - Brand Discovery and Listing
 * 
 * Provides atomic capability for searching and discovering design systems
 * from the awesome-design-md collection.
 */

import type { 
  SearchCapability, 
  SearchInput, 
  SearchOutput, 
  ListOutput,
  CategoryInfo 
} from '../types'
import { 
  searchBrands, 
  getAllCategories, 
  getAllBrands,
  getBrandsByCategory 
} from '../utils/brands'

export const searchCapability: SearchCapability = {
  async search(input: SearchInput): Promise<SearchOutput> {
    const { query, category, limit = 20 } = input

    let results = searchBrands(query, category)
    
    if (limit && results.length > limit) {
      results = results.slice(0, limit)
    }

    const categories = getAllCategories()

    return {
      success: true,
      results,
      total: results.length,
      categories: categories.map(c => c.id),
      query
    }
  },

  async list(): Promise<ListOutput> {
    const brands = getAllBrands()
    const categories = getAllCategories()

    return {
      success: true,
      categories,
      totalBrands: brands.length,
      brands
    }
  },

  async getCategories(): Promise<CategoryInfo[]> {
    return getAllCategories()
  }
}
