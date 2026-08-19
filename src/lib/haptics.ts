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
export type HapticKind = 'tick' | 'success' | 'error' | 'thinking';

export const HAPTIC_PATTERNS: Record<HapticKind, number[]> = {
	tick: [8],
	success: [15],
	error: [30, 60, 30],
	// Three light taps. Repeated on an interval by the runtime for as long as
	// Harmony is working — a pulse you can feel without looking, and light
	// enough that it never reads as an alert.
	thinking: [6, 90, 6, 90, 6]
};

/** How often the thinking pulse repeats while it runs. */
export const THINKING_PERIOD_MS = 1400;

/**
 * Where a pattern's pulses *start*, in milliseconds from the beginning.
 *
 * The Vibration API takes the whole on/off array and renders it itself. iOS has
 * no Vibration API at all, and its one haptic channel (see haptics.svelte) can
 * only produce a single tap with no duration — so a pattern has to be played
 * there as a series of taps scheduled at the right moments. `[30, 60, 30]` is
 * two taps 90ms apart; the odd entries are silence and produce nothing.
 *
 * Pure, so the schedule is testable without a device that can buzz.
 */
export function tapOffsets(pattern: number[]): number[] {
	const offsets: number[] = [];
	let at = 0;
	for (let i = 0; i < pattern.length; i++) {
		if (i % 2 === 0) offsets.push(at);
		at += pattern[i];
	}
	return offsets;
}

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
