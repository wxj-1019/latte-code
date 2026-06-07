// Mock for Bun's test module (bun:test)
// Mirrors vitest API so test files can import from either.
export { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
