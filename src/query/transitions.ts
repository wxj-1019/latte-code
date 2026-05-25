/**
 * Query loop transition types.
 *
 * These are the discriminated unions that type-check every exit (Terminal)
 * and every iteration-continue (Continue) in query.ts's main loop.
 *
 * Extracted to its own file to:
 *   1. Keep the 1729-line query.ts leaner.
 *   2. Let tests import and match on transition reasons without pulling
 *      the full query module graph.
 *   3. Make adding/removing a reason a single-file diff with compile-time
 *      enforcement across all 23 return sites and 7 continue sites.
 */

// ---------------------------------------------------------------------------
// Terminal — query() generator return type
// ---------------------------------------------------------------------------

/** Reasons the query loop can terminate (exit the while(true) loop). */
export type TerminalReason =
  | 'completed'
  | 'aborted_streaming'
  | 'aborted_tools'
  | 'blocking_limit'
  | 'max_turns'
  | 'image_error'
  | 'prompt_too_long'
  | 'hook_stopped'
  | 'stop_hook_prevented'
  | 'model_error'

/**
 * Discriminated union returned by `query()` / `queryLoop()`.
 *
 * Callers (QueryEngine, print.ts, SDK) switch on `reason` to decide
 * post-loop behavior: save costs, show interruption, suggest /compact, etc.
 */
export type Terminal = {
  [R in TerminalReason]: R extends 'max_turns'
    ? { reason: R; turnCount: number }
    : R extends 'model_error'
      ? { reason: R; error?: unknown }
      : { reason: R }
}[TerminalReason]

// ---------------------------------------------------------------------------
// Continue — State.transition tracking (why the loop iterated again)
// ---------------------------------------------------------------------------

/** Reasons the query loop chose to iterate again. */
export type ContinueReason =
  | 'next_turn'
  | 'collapse_drain_retry'
  | 'reactive_compact_retry'
  | 'max_output_tokens_escalate'
  | 'max_output_tokens_recovery'
  | 'stop_hook_blocking'
  | 'token_budget_continuation'

/**
 * Stored on `State.transition` at each continue site.
 *
 * Lets tests assert recovery paths fired without inspecting message contents
 * (e.g. `expect(terminal.transition?.reason).toBe('reactive_compact_retry')`).
 * Callers outside tests do not read this field.
 */
export type Continue = {
  [R in ContinueReason]: R extends 'collapse_drain_retry'
    ? { reason: R; committed: number }
    : R extends 'max_output_tokens_recovery'
      ? { reason: R; attempt: number }
      : { reason: R }
}[ContinueReason]
