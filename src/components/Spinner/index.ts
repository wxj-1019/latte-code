export { FlashingChar } from './FlashingChar.js'
export { GlimmerMessage } from './GlimmerMessage.js'
export { ShimmerChar } from './ShimmerChar.js'
export { SpinnerGlyph } from './SpinnerGlyph.js'
export type { SpinnerMode } from './types.js'
export { useShimmerAnimation } from './useShimmerAnimation.js'
export { useStalledAnimation } from './useStalledAnimation.js'
export { getDefaultCharacters, interpolateColor } from './utils.js'
// Teammate components are NOT exported here - use dynamic require() to enable dead code elimination
// See REPL.tsx and Spinner.tsx for the correct import pattern

// New animation hooks
export { usePulseAnimation, PulseEffect } from './usePulseAnimation.js'
export type { PulseEffectProps } from './usePulseAnimation.js'

export { useTypewriterAnimation, TypewriterEffect } from './useTypewriterAnimation.js'
export type { TypewriterEffectProps } from './useTypewriterAnimation.js'

export {
  useWaveAnimation,
  useVerticalWaveAnimation,
  WaveEffect,
} from './useWaveAnimation.js'
export type { WaveEffectProps } from './useWaveAnimation.js'

export {
  useBlinkAnimation,
  useDutyBlinkAnimation,
  useFadeBlinkAnimation,
  BlinkEffect,
  FadeBlinkEffect,
} from './useBlinkAnimation.js'
export type { BlinkEffectProps, FadeBlinkEffectProps } from './useBlinkAnimation.js'

export {
  useProgressBarAnimation,
  useSegmentedProgressBarAnimation,
  ProgressBarEffect,
} from './useProgressBarAnimation.js'
export type { ProgressBarEffectProps } from './useProgressBarAnimation.js'
