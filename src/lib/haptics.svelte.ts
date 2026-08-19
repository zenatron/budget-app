/**
 * Haptics preference — a per-device choice, not an account setting. A phone
 * vibrates and a laptop doesn't, so the same person wants it on one device and
 * would never find it on the other; a workspace column would be the wrong
 * home. Modeled on theme.svelte: localStorage is the source of truth, absent
 * means on.
 *
 * Also the runtime half of haptics.ts: `haptic(kind)` checks the pref and the
 * available channel, then plays the pattern.
 *
 * There are two channels, because there is no one API that covers both phones.
 *
 *   Vibration API — Android and desktop Chrome/Firefox. Takes the whole on/off
 *     pattern and renders it itself.
 *   The switch input — iOS. Safari has never shipped navigator.vibrate, so for
 *     years every haptic in this app was a silent no-op on iPhone, which is
 *     exactly what it felt like: nothing. Safari 17.4 gave
 *     `<input type="checkbox" switch>` a real haptic when it toggles, and
 *     toggling one from script fires it. That is the only haptic a web app can
 *     reach on iOS, and it is a single tap with no duration or strength — so a
 *     pattern is played there as taps scheduled at each pulse's start
 *     (`tapOffsets`), and the off-gaps become silence for free.
 */
import { browser } from '$app/environment';
import { pickPattern, tapOffsets, THINKING_PERIOD_MS, type HapticKind } from '$lib/haptics';

const KEY = 'haptics';

function read(): boolean {
	if (!browser) return true;
	return localStorage.getItem(KEY) !== 'off';
}

const canVibrate = () =>
	typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/**
 * Whether this browser has the switch control that carries iOS's haptic. The
 * attribute is reflected as a property only where it is implemented, which is
 * the same Safari version that added the feedback, so one test covers both.
 */
const canSwitch = () => browser && 'switch' in document.createElement('input');

const supported = () => canVibrate() || canSwitch();

/**
 * The hidden switch, created once and reused. It sits outside the layout and
 * outside the accessibility tree: it is a way to reach a system sound, not a
 * control, and a screen reader announcing "switch, off" every time a form saved
 * would be worse than no haptics at all.
 */
let tapper: HTMLLabelElement | null = null;

function tap(): void {
	if (!browser) return;
	if (!tapper) {
		const label = document.createElement('label');
		label.setAttribute('aria-hidden', 'true');
		label.style.cssText =
			'position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none;overflow:hidden';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('switch', '');
		input.tabIndex = -1;
		label.appendChild(input);
		document.body.appendChild(label);
		tapper = label;
	}
	tapper.click();
}

/** Play a pattern on whichever channel this device actually has. */
function play(pattern: number[]): void {
	if (canVibrate()) {
		navigator.vibrate(pattern);
		return;
	}
	// Offset 0 fires now rather than through a timer, so the first tap of a
	// pattern lands in the same frame as the gesture that caused it.
	for (const at of tapOffsets(pattern)) {
		if (at === 0) tap();
		else setTimeout(tap, at);
	}
}

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
	if (pattern) play(pattern);
}

/**
 * A pulse that runs until you stop it, for work with no determinate end —
 * Harmony thinking, today. Returns its own stopper, so a caller can start it in
 * an effect and hand the stopper straight back as the cleanup.
 *
 * Starting twice is safe: the second call stops the first, so a component that
 * re-runs its effect can't leave two pulses beating out of phase.
 */
let thinkingTimer: ReturnType<typeof setInterval> | null = null;

export function startThinking(): () => void {
	stopThinking();
	if (!browser) return () => {};
	// Checked once here rather than per tick: the pref cannot change without a
	// tap, and a tap is what would stop this anyway.
	if (!pickPattern('thinking', { enabled: haptics.on, supported: supported() })) return () => {};
	haptic('thinking');
	thinkingTimer = setInterval(() => haptic('thinking'), THINKING_PERIOD_MS);
	return stopThinking;
}

export function stopThinking(): void {
	if (thinkingTimer === null) return;
	clearInterval(thinkingTimer);
	thinkingTimer = null;
	// Cut any vibration still running from the last pulse, so stopping is felt
	// as stopping. Harmless where the API is absent.
	if (canVibrate()) navigator.vibrate(0);
}
