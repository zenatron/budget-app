/**
 * The haptics vocabulary — pure and framework-free so it can be unit-tested
 * the way deep-link is. The runes shell in haptics.svelte owns the preference
 * and the navigator call; this owns the words.
 *
 * Three words, each one gesture-sized. A tick says a thing latched (a swipe
 * reveal); success and error bracket a form result the way toasts do. Patterns
 * stay short — a vibration long enough to read as "attention" belongs to a
 * notification, not to feedback the person just caused with their own thumb.
 *
 * Deliberately not gated on prefers-reduced-motion: that media query governs
 * motion, and a 15ms buzz is not motion. The per-device haptics pref is the
 * gate for this channel (see haptics.svelte).
 */
export type HapticKind = 'tick' | 'success' | 'error';

export const HAPTIC_PATTERNS: Record<HapticKind, number[]> = {
	tick: [8],
	success: [15],
	error: [30, 60, 30]
};

/**
 * The pattern to fire, or undefined when the channel is closed — either the
 * pref is off or the Vibration API isn't there (every iOS device, every
 * desktop browser that never shipped it). Callers treat undefined as "say
 * nothing", never as an error.
 */
export function pickPattern(
	kind: HapticKind,
	state: { enabled: boolean; supported: boolean }
): number[] | undefined {
	if (!state.enabled || !state.supported) return undefined;
	return HAPTIC_PATTERNS[kind];
}
