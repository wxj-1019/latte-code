import { useRef } from 'react'

/**
 * Typewriter animation hook - reveals text character by character.
 * Useful for simulating typing effects.
 *
 * @param text - Full text to reveal
 * @param charIntervalMs - Time between each character reveal (default: 50ms)
 * @param startDelayMs - Delay before animation starts (default: 0ms)
 * @returns Object with visibleText and isComplete
 */
export function useTypewriterAnimation(
  time: number,
  text: string,
  charIntervalMs = 50,
  startDelayMs = 0,
  reducedMotion = false,
): {
  visibleText: string
  isComplete: boolean
  progress: number
} {
  const startTimeRef = useRef<number | null>(null)

  // If reduced motion, show full text immediately
  if (reducedMotion) {
    return {
      visibleText: text,
      isComplete: true,
      progress: 1,
    }
  }

  // Initialize start time on first call
  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current

  // Account for start delay
  if (elapsed < startDelayMs) {
    return {
      visibleText: '',
      isComplete: false,
      progress: 0,
    }
  }

  const animationElapsed = elapsed - startDelayMs
  const charsToShow = Math.floor(animationElapsed / charIntervalMs)
  const visibleLength = Math.min(charsToShow, text.length)
  const isComplete = visibleLength >= text.length

  return {
    visibleText: text.slice(0, visibleLength),
    isComplete,
    progress: visibleLength / text.length,
  }
}

/**
 * Typewriter effect component props
 */
export type TypewriterEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Full text to reveal */
  text: string
  /** Time between each character reveal */
  charIntervalMs?: number
  /** Delay before animation starts */
  startDelayMs?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Render function */
  children: (visibleText: string, isComplete: boolean, progress: number) => React.ReactNode
}

/**
 * Typewriter effect render component
 */
export function TypewriterEffect({
  time,
  text,
  charIntervalMs = 50,
  startDelayMs = 0,
  reducedMotion = false,
  children,
}: TypewriterEffectProps): React.ReactNode {
  const { visibleText, isComplete, progress } = useTypewriterAnimation(
    time,
    text,
    charIntervalMs,
    startDelayMs,
    reducedMotion,
  )
  return children(visibleText, isComplete, progress)
}
