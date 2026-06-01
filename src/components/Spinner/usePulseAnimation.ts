import { useRef } from 'react'

/**
 * Pulse animation hook - creates a pulsing opacity effect.
 * Useful for drawing attention to important states.
 *
 * @param intervalMs - Pulse cycle duration in ms (default: 1000)
 * @param minOpacity - Minimum opacity value (default: 0.3)
 * @param maxOpacity - Maximum opacity value (default: 1.0)
 * @returns Current opacity value (0-1)
 */
export function usePulseAnimation(
  time: number,
  intervalMs = 1000,
  minOpacity = 0.3,
  maxOpacity = 1.0,
  reducedMotion = false,
): number {
  const startTimeRef = useRef<number | null>(null)

  if (reducedMotion) {
    return maxOpacity
  }

  // Initialize start time on first call
  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const progress = (elapsed % intervalMs) / intervalMs

  // Use sine wave for smooth pulsing
  const sineValue = Math.sin(progress * Math.PI * 2)
  const normalizedValue = (sineValue + 1) / 2 // Normalize from [-1,1] to [0,1]

  return minOpacity + normalizedValue * (maxOpacity - minOpacity)
}

/**
 * Pulse effect component props
 */
export type PulseEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Pulse cycle duration in ms */
  intervalMs?: number
  /** Minimum opacity */
  minOpacity?: number
  /** Maximum opacity */
  maxOpacity?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Children to render with pulse effect */
  children: (opacity: number) => React.ReactNode
}

/**
 * Pulse effect render component
 */
export function PulseEffect({
  time,
  intervalMs = 1000,
  minOpacity = 0.3,
  maxOpacity = 1.0,
  reducedMotion = false,
  children,
}: PulseEffectProps): React.ReactNode {
  const opacity = usePulseAnimation(time, intervalMs, minOpacity, maxOpacity, reducedMotion)
  return children(opacity)
}
