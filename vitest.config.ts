import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // Only test src/query/__tests__ for now; expand later
    include: [
      'src/query/__tests__/**/*.test.ts',
      'src/commands/goal/__tests__/**/*.test.ts',
    ],
    pool: 'forks',
  },
  resolve: {
    alias: {
      'src/': path.resolve(__dirname, 'src') + '/',
      // Mock bun:bundle – test environments can't use Bun compile-time features
      'bun:bundle': path.resolve(__dirname, 'src/__mocks__/bun-bundle.ts'),
      'bun:test': path.resolve(__dirname, 'src/__mocks__/bun-test.ts'),
    },
    // Handle .js extension imports that map to .ts files
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
})
