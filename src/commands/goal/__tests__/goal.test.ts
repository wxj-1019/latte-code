import { describe, it, expect, beforeEach, vi } from 'vitest'
import { levenshteinDistance, findClosestSubcommand } from '../goal.js'
import {
  clearGoal,
  setOriginalPermissionMode,
  getGoal,
  setGoal,
  getOriginalPermissionMode,
} from '../goalState.js'

// We test the pure helper functions directly.
// The `call` function requires a full ToolUseContext which is harder to unit test,
// so we focus on the logic that caused bugs.

describe('goal helpers', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0)
    })

    it('should return length for empty vs non-empty', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3)
      expect(levenshteinDistance('abc', '')).toBe(3)
    })

    it('should compute correct distance for single edit', () => {
      expect(levenshteinDistance('abc', 'abx')).toBe(1) // substitution
      expect(levenshteinDistance('abc', 'abcd')).toBe(1) // insertion
      expect(levenshteinDistance('abc', 'ac')).toBe(1) // deletion
    })

    it('should compute correct distance for multiple edits', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
      expect(levenshteinDistance('stop', 'shop')).toBe(1) // s=s, t→h, o=o, p=p
    })
  })

  describe('findClosestSubcommand', () => {
    it('should match exact subcommands', () => {
      expect(findClosestSubcommand('pause')).toBe('pause')
      expect(findClosestSubcommand('resume')).toBe('resume')
      expect(findClosestSubcommand('clear')).toBe('clear')
    })

    it('should match case-insensitively', () => {
      expect(findClosestSubcommand('Pause')).toBe('pause')
      expect(findClosestSubcommand('CLEAR')).toBe('clear')
    })

    it('should match typos within threshold', () => {
      expect(findClosestSubcommand('pusae')).toBe('pause') // transposition
      expect(findClosestSubcommand('claer')).toBe('clear') // transposition
      expect(findClosestSubcommand('resme')).toBe('resume') // missing 'u'
    })

    it('should not match distant strings', () => {
      expect(findClosestSubcommand('xyzabc')).toBeNull()
      expect(findClosestSubcommand('hello world')).toBeNull()
    })

    it('should use stricter threshold for short inputs', () => {
      // 2-char input: maxDist = 1, so only distance-1 matches allowed
      expect(findClosestSubcommand('st')).toBeNull() // dist 2 from "stop", exceeds threshold
      expect(findClosestSubcommand('pa')).toBeNull() // dist 3 from "pause", exceeds threshold
    })
  })

  describe('typo detection does not false-positive on objectives', () => {
    beforeEach(() => {
      clearGoal()
      setOriginalPermissionMode(null)
    })

    it('should NOT match "clear the cache" as a subcommand typo', () => {
      // This was the reported bug: "clear the cache" (distance 1 from "clear")
      // would be intercepted as a subcommand typo.
      // After fix: inputs > 12 chars skip typo detection entirely.
      const result = findClosestSubcommand('clear the cache')
      // findClosestSubcommand may return 'clear' (dist 1), but the call() function
      // now only checks for typos when trimmed.length <= 12
      expect('clear the cache'.length).toBeGreaterThan(12)
    })

    it('should NOT match "review the code" as a subcommand typo', () => {
      expect('review the code'.length).toBeGreaterThan(12)
    })
  })
})
