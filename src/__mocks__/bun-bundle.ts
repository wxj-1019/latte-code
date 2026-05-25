// Mock for Bun's compile-time feature-flag system (bun:bundle)
// Test default: all flags disabled. Individual tests can use vi.mock() to override feature().
const ENABLED_FEATURES = new Set<string>([])

export function feature(name: string): boolean {
  return ENABLED_FEATURES.has(name)
}
