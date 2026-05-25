/**
 * Memory conflict detection and resolution.
 *
 * When new memories are extracted, they may conflict with existing ones.
 * This module provides utilities to detect and resolve such conflicts.
 */

import { readFile } from 'fs/promises'
import { basename } from 'path'

export type MemoryConflict = {
  existingPath: string
  newPath: string
  conflictType: 'duplicate' | 'contradiction' | 'superseded'
  similarity: number
  suggestion: 'merge' | 'replace' | 'keep_both' | 'skip'
}

/**
 * Compute Jaccard similarity between two text strings.
 */
function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))

  if (tokensA.size === 0 && tokensB.size === 0) return 1
  if (tokensA.size === 0 || tokensB.size === 0) return 0

  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++
  }

  return intersection / (tokensA.size + tokensB.size - intersection)
}

/**
 * Check if two memory files are duplicates (same filename or very similar content).
 */
export async function detectConflicts(
  existingPaths: string[],
  newPaths: string[],
): Promise<MemoryConflict[]> {
  const conflicts: MemoryConflict[] = []

  // Pre-read all existing files
  const existingContents = new Map<string, string>()
  for (const path of existingPaths) {
    try {
      const content = await readFile(path, 'utf8')
      existingContents.set(path, content)
    } catch {
      // Skip unreadable files
    }
  }

  for (const newPath of newPaths) {
    let newContent: string
    try {
      newContent = await readFile(newPath, 'utf8')
    } catch {
      continue
    }

    const newFilename = basename(newPath, '.md')

    for (const [existingPath, existingContent] of existingContents) {
      const existingFilename = basename(existingPath, '.md')

      // Check for exact filename match (duplicate)
      if (newFilename === existingFilename) {
        conflicts.push({
          existingPath,
          newPath,
          conflictType: 'duplicate',
          similarity: 1.0,
          suggestion: 'replace',
        })
        continue
      }

      // Check content similarity
      const similarity = textSimilarity(existingContent, newContent)

      if (similarity > 0.85) {
        // Very similar - likely duplicate with different filename
        conflicts.push({
          existingPath,
          newPath,
          conflictType: 'duplicate',
          similarity,
          suggestion: 'merge',
        })
      } else if (similarity > 0.6) {
        // Moderately similar - may be contradiction or superseded
        conflicts.push({
          existingPath,
          newPath,
          conflictType: 'contradiction',
          similarity,
          suggestion: 'keep_both',
        })
      }
    }
  }

  return conflicts
}

/**
 * Resolve conflicts by applying suggestions.
 * Returns the list of new paths that should be kept.
 */
export function resolveConflicts(
  conflicts: MemoryConflict[],
  newPaths: string[],
): string[] {
  const pathsToSkip = new Set<string>()

  for (const conflict of conflicts) {
    switch (conflict.suggestion) {
      case 'replace':
        // Keep new, mark old for deletion (caller handles)
        break
      case 'merge':
        // Keep both for now, mark for manual review
        break
      case 'skip':
        pathsToSkip.add(conflict.newPath)
        break
      case 'keep_both':
      default:
        // Default: keep both
        break
    }
  }

  return newPaths.filter(p => !pathsToSkip.has(p))
}

/**
 * Format conflicts for display to the user.
 */
export function formatConflicts(conflicts: MemoryConflict[]): string {
  if (conflicts.length === 0) return 'No conflicts detected.'

  const lines: string[] = [
    `Detected ${conflicts.length} memory conflict(s):`,
    '',
  ]

  for (const c of conflicts) {
    lines.push(`  ${c.conflictType.toUpperCase()} (${(c.similarity * 100).toFixed(0)}% similar):`)
    lines.push(`    Existing: ${basename(c.existingPath)}`)
    lines.push(`    New:      ${basename(c.newPath)}`)
    lines.push(`    Suggestion: ${c.suggestion}`)
    lines.push('')
  }

  return lines.join('\n')
}
