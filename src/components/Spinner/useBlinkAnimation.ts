import { useRef } from 'react'

/**
 * Blink animation hook - creates a blinking effect.
 * Useful for cursors, indicators, and attention-grabbing elements.
 *
 * @param onMs - Time visible in ms (default: 500)
 * @param offMs - Time hidden in ms (default: 500)
 * @returns Boolean indicating if element should be visible
 */
export function useBlinkAnimation(
  time: number,
  onMs = 500,
  offMs = 500,
  reducedMotion = false,
): boolean {
  const startTimeRef = useRef<number | null>(null)

  // If reduced motion, always visible
  if (reducedMotion) {
    return true
  }

  // Initialize start time on first call
  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const cycleDuration = onMs + offMs
  const cyclePosition = elapsed % cycleDuration

  return cyclePosition < onMs
}

/**
 * Blink animation with configurable visibility ratio
 *
 * @param dutyCycle - Visibility ratio 0-1 (default: 0.5)
 * @param cycleMs - Total cycle duration (default: 1000ms)
 * @returns Boolean indicating if element should be visible
 */
export function useDutyBlinkAnimation(
  time: number,
  dutyCycle = 0.5,
  cycleMs = 1000,
  reducedMotion = false,
): boolean {
  const startTimeRef = useRef<number | null>(null)

  if (reducedMotion) {
    return true
  }

  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const cyclePosition = (elapsed % cycleMs) / cycleMs

  return cyclePosition < dutyCycle
}

/**
 * Fade blink animation - creates a smooth fade in/out effect
 *
 * @param cycleMs - Total cycle duration (default: 2000ms)
 * @param minOpacity - Minimum opacity (default: 0.0)
 * @param maxOpacity - Maximum opacity (default: 1.0)
 * @returns Current opacity value
 */
export function useFadeBlinkAnimation(
  time: number,
  cycleMs = 2000,
  minOpacity = 0.0,
  maxOpacity = 1.0,
  reducedMotion = false,
): number {
  const startTimeRef = useRef<number | null>(null)

  if (reducedMotion) {
    return maxOpacity
  }

  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const progress = (elapsed % cycleMs) / cycleMs

  // Use sine wave for smooth fade
  const sineValue = Math.sin(progress * Math.PI * 2)
  const normalizedValue = (sineValue + 1) / 2

  return minOpacity + normalizedValue * (maxOpacity - minOpacity)
}

/**
 * Blink effect component props
 */
export type BlinkEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Time visible in ms */
  onMs?: number
  /** Time hidden in ms */
  offMs?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Render function */
  children: (isVisible: boolean) => React.ReactNode
}

/**
 * Blink effect render component
 */
export function BlinkEffect({
  time,
  onMs = 500,
  offMs = 500,
  reducedMotion = false,
  children,
}: BlinkEffectProps): React.ReactNode {
  const isVisible = useBlinkAnimation(time, onMs, offMs, reducedMotion)
  return children(isVisible)
}

/**
 * Fade blink effect component props
 */
export type FadeBlinkEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Total cycle duration */
  cycleMs?: number
  /** Minimum opacity */
  minOpacity?: number
  /** Maximum opacity */
  maxOpacity?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Render function */
  children: (opacity: number) => React.ReactNode
}

/**
 * Fade blink effect render component
 */
export function FadeBlinkEffect({
  time,
  cycleMs = 2000,
  minOpacity = 0.0,
  maxOpacity = 1.0,
  reducedMotion = false,
  children,
}: FadeBlinkEffectProps): React.ReactNode {
  const opacity = useFadeBlinkAnimation(time, cycleMs, minOpacity, maxOpacity, reducedMotion)
  return children(opacity)
}
