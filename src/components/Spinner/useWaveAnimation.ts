import { useRef } from 'react'

/**
 * Wave animation hook - creates a wave effect across characters.
 * Each character has a phase offset creating a wave motion.
 *
 * @param charCount - Number of characters to animate
 * @param waveLength - Number of characters per wave cycle (default: 10)
 * @param speedMs - Time for one complete wave cycle (default: 1000ms)
 * @param amplitude - Maximum offset value (default: 1)
 * @returns Array of offset values for each character
 */
export function useWaveAnimation(
  time: number,
  charCount: number,
  waveLength = 10,
  speedMs = 1000,
  amplitude = 1,
  reducedMotion = false,
): number[] {
  const startTimeRef = useRef<number | null>(null)

  // If reduced motion, return zero offsets
  if (reducedMotion) {
    return new Array(charCount).fill(0)
  }

  // Initialize start time on first call
  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const offsets: number[] = []

  for (let i = 0; i < charCount; i++) {
    // Calculate phase based on character position and time
    const phase = (i / waveLength) * Math.PI * 2
    const timePhase = (elapsed / speedMs) * Math.PI * 2
    const sineValue = Math.sin(phase + timePhase)
    offsets.push(sineValue * amplitude)
  }

  return offsets
}

/**
 * Vertical wave animation hook - creates a vertical wave effect.
 *
 * @param lineCount - Number of lines to animate
 * @param waveLength - Number of lines per wave cycle (default: 5)
 * @param speedMs - Time for one complete wave cycle (default: 1500ms)
 * @param amplitude - Maximum vertical offset (default: 1)
 * @returns Array of vertical offset values for each line
 */
export function useVerticalWaveAnimation(
  time: number,
  lineCount: number,
  waveLength = 5,
  speedMs = 1500,
  amplitude = 1,
  reducedMotion = false,
): number[] {
  const startTimeRef = useRef<number | null>(null)

  if (reducedMotion) {
    return new Array(lineCount).fill(0)
  }

  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current
  const offsets: number[] = []

  for (let i = 0; i < lineCount; i++) {
    const phase = (i / waveLength) * Math.PI * 2
    const timePhase = (elapsed / speedMs) * Math.PI * 2
    const sineValue = Math.sin(phase + timePhase)
    offsets.push(Math.round(sineValue * amplitude))
  }

  return offsets
}

/**
 * Wave effect component props
 */
export type WaveEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Number of characters to animate */
  charCount: number
  /** Number of characters per wave cycle */
  waveLength?: number
  /** Time for one complete wave cycle */
  speedMs?: number
  /** Maximum offset value */
  amplitude?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Render function with offsets */
  children: (offsets: number[]) => React.ReactNode
}

/**
 * Wave effect render component
 */
export function WaveEffect({
  time,
  charCount,
  waveLength = 10,
  speedMs = 1000,
  amplitude = 1,
  reducedMotion = false,
  children,
}: WaveEffectProps): React.ReactNode {
  const offsets = useWaveAnimation(time, charCount, waveLength, speedMs, amplitude, reducedMotion)
  return children(offsets)
}
