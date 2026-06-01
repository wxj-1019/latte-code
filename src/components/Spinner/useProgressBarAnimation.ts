import { useRef } from 'react'

/**
 * Progress bar animation hook - creates an animated progress bar.
 * Supports indeterminate (loading) and determinate (percentage) modes.
 *
 * @param progress - Progress value 0-1, or -1 for indeterminate mode
 * @param width - Width of progress bar in characters (default: 20)
 * @param speedMs - Speed for indeterminate animation (default: 1000ms)
 * @returns Object with fill characters and positions
 */
export function useProgressBarAnimation(
  time: number,
  progress: number,
  width = 20,
  speedMs = 1000,
  reducedMotion = false,
): {
  bar: string
  percentage: number
  isIndeterminate: boolean
} {
  const startTimeRef = useRef<number | null>(null)
  const isIndeterminate = progress < 0

  // Initialize start time on first call
  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current

  // Reduced motion: show simple bar without animation
  if (reducedMotion) {
    if (isIndeterminate) {
      const fill = '█'.repeat(width)
      return { bar: fill, percentage: -1, isIndeterminate: true }
    }
    const filled = Math.round(progress * width)
    const empty = width - filled
    const bar = '█'.repeat(filled) + '░'.repeat(empty)
    return { bar, percentage: Math.round(progress * 100), isIndeterminate: false }
  }

  // Indeterminate mode: bouncing block
  if (isIndeterminate) {
    const cycleLength = width * 2
    const position = (elapsed / speedMs * cycleLength) % cycleLength
    const blockPos = Math.floor(position < width ? position : cycleLength - position)
    const blockWidth = Math.max(1, Math.floor(width / 4))

    let bar = ''
    for (let i = 0; i < width; i++) {
      if (i >= blockPos && i < blockPos + blockWidth) {
        bar += '█'
      } else if (i >= blockPos - 1 && i <= blockPos + blockWidth) {
        bar += '▓'
      } else {
        bar += '░'
      }
    }

    return { bar, percentage: -1, isIndeterminate: true }
  }

  // Determinate mode: smooth fill
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const filled = Math.round(clampedProgress * width)
  const empty = width - filled

  // Add pulse effect to the leading edge
  const pulsePhase = (elapsed % 500) / 500
  const pulseChar = pulsePhase < 0.5 ? '█' : '▓'

  let bar = ''
  if (filled > 0) {
    bar = '█'.repeat(filled - 1) + pulseChar
  }
  bar += '░'.repeat(empty)

  return {
    bar,
    percentage: Math.round(clampedProgress * 100),
    isIndeterminate: false,
  }
}

/**
 * Segmented progress bar animation
 *
 * @param segments - Array of segment states (0=empty, 1=partial, 2=complete)
 * @param speedMs - Animation speed for partial segments (default: 500ms)
 * @returns Formatted bar string
 */
export function useSegmentedProgressBarAnimation(
  time: number,
  segments: number[],
  speedMs = 500,
  reducedMotion = false,
): string {
  const startTimeRef = useRef<number | null>(null)

  if (startTimeRef.current === null) {
    startTimeRef.current = time
  }

  const elapsed = time - startTimeRef.current

  return segments.map((state, i) => {
    if (state === 0) return '░'
    if (state === 2) return '█'

    // Partial state: animated
    if (reducedMotion) return '▓'

    const phase = ((elapsed / speedMs) + (i * 0.2)) % 1
    return phase < 0.5 ? '▓' : '▒'
  }).join('')
}

/**
 * Progress bar effect component props
 */
export type ProgressBarEffectProps = {
  /** Animation time from useAnimationFrame */
  time: number
  /** Progress value 0-1, or -1 for indeterminate */
  progress: number
  /** Width of progress bar in characters */
  width?: number
  /** Animation speed for indeterminate mode */
  speedMs?: number
  /** Whether reduced motion is enabled */
  reducedMotion?: boolean
  /** Render function */
  children: (bar: string, percentage: number, isIndeterminate: boolean) => React.ReactNode
}

/**
 * Progress bar effect render component
 */
export function ProgressBarEffect({
  time,
  progress,
  width = 20,
  speedMs = 1000,
  reducedMotion = false,
  children,
}: ProgressBarEffectProps): React.ReactNode {
  const { bar, percentage, isIndeterminate } = useProgressBarAnimation(
    time,
    progress,
    width,
    speedMs,
    reducedMotion,
  )
  return children(bar, percentage, isIndeterminate)
}
