/**
 * Design-MD Capability Registry
 * 
 * Central registry for all atomic capabilities. This is the main entry point
 * for the AI system to access design-md capabilities.
 */

import type { 
  CapabilityRegistry, 
  CapabilityInput, 
  CapabilityOutput,
  CapabilityType
} from './types'
import { fetchCapability } from './capabilities/fetch'
import { searchCapability } from './capabilities/search'
import { analyzeCapability } from './capabilities/analyze'
import { generateCapability } from './capabilities/generate'
import { compareCapability } from './capabilities/compare'
import { extractCapability } from './capabilities/extract'
import { adviseCapability } from './capabilities/advise'

// Singleton registry instance
const registry: CapabilityRegistry = {
  fetch: fetchCapability,
  search: searchCapability,
  analyze: analyzeCapability,
  generate: generateCapability,
  compare: compareCapability,
  extract: extractCapability,
  advise: adviseCapability
}

/**
 * Get a specific capability by type
 */
export function getCapability<T extends CapabilityType>(
  type: T
): CapabilityRegistry[T] {
  return registry[type]
}

/**
 * Execute a capability with the given input
 * This is the main entry point for AI-driven capability execution
 */
export async function executeCapability(
  input: CapabilityInput
): Promise<CapabilityOutput> {
  switch (input.type) {
    case 'fetch':
      return registry.fetch.get(input.input)
    case 'search':
      return registry.search.search(input.input)
    case 'analyze':
      return registry.analyze.analyze(input.input)
    case 'generate':
      return registry.generate.generate(input.input)
    case 'compare':
      return registry.compare.compare(input.input)
    case 'extract':
      return registry.extract.extract(input.input)
    case 'advise':
      return executeAdviseCapability(input.input)
    case 'list':
      return registry.search.list()
    default:
      throw new Error(`Unknown capability type: ${(input as any).type}`)
  }
}

/**
 * Execute advise capability with the specific action
 */
async function executeAdviseCapability(
  input: any
): Promise<CapabilityOutput> {
  switch (input.action) {
    case 'review':
      return registry.advise.review(input.data)
    case 'suggest':
      return registry.advise.suggest(input.data)
    case 'plan':
      return registry.advise.createDesignPlan(input.data)
    case 'apply':
      return registry.advise.applyToComponent(input.data)
    default:
      throw new Error(`Unknown advise action: ${input.action}`)
  }
}

/**
 * Get all available capabilities
 */
export function getAllCapabilities(): CapabilityType[] {
  return ['fetch', 'search', 'analyze', 'generate', 'compare', 'extract', 'advise']
}

/**
 * Check if a capability is available
 */
export function hasCapability(type: CapabilityType): boolean {
  return type in registry
}

// Re-export all capabilities for direct access
export {
  fetchCapability,
  searchCapability,
  analyzeCapability,
  generateCapability,
  compareCapability,
  extractCapability,
  adviseCapability
}

// Re-export types
export * from './types'
