/**
 * Haptics preference — a per-device choice, not an account setting. A phone
 * vibrates and a laptop doesn't, so the same person wants it on one device and
 * would never find it on the other; a workspace column would be the wrong
 * home. Modeled on theme.svelte: localStorage is the source of truth, absent
 * means on.
 *
 * Also the runtime half of haptics.ts: `haptic(kind)` checks the pref and the
 * Vibration API, then fires the pattern. iOS Safari has no navigator.vibrate
 * at all, which is the quiet no-op it sounds like — nothing to feature-flag.
 */
import { browser } from '$app/environment';
import { pickPattern, type HapticKind } from '$lib/haptics';

const KEY = 'haptics';

function read(): boolean {
	if (!browser) return true;
	return localStorage.getItem(KEY) !== 'off';
}

const supported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** Reactive so the settings control tracks the live choice. */
export const haptics = $state<{ on: boolean }>({ on: read() });

export function setHaptics(on: boolean): void {
	haptics.on = on;
	if (!browser) return;
	// On is the default, stored as absence — the same shape theme.svelte uses
	// for 'system', so a stale key can never outlive a change of mind.
	if (on) localStorage.removeItem(KEY);
	else localStorage.setItem(KEY, 'off');
}

export function haptic(kind: HapticKind): void {
	if (!browser) return;
	const pattern = pickPattern(kind, { enabled: haptics.on, supported: supported() });
	if (pattern) navigator.vibrate(pattern);
}
