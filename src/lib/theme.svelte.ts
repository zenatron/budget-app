/**
 * Theme preference — a per-device choice, not an account setting.
 *
 * The source of truth is localStorage (`theme`), first applied by the pre-paint
 * script in app.html so there's never a flash. This module is the runtime half:
 * it exposes the current preference reactively for the toggle, writes changes
 * back, and keeps `data-theme` + the `theme-color` meta in step. The tokens
 * themselves switch in CSS via `color-scheme` / `light-dark()` — no work here.
 */
import { browser } from '$app/environment';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'theme';
const DARK_PAPER = '#201c17';
const LIGHT_PAPER = '#F4EEE1';

function read(): ThemePref {
	if (!browser) return 'system';
	const v = localStorage.getItem(KEY);
	return v === 'light' || v === 'dark' ? v : 'system';
}

function resolvesDark(pref: ThemePref): boolean {
	if (pref === 'dark') return true;
	if (pref === 'light') return false;
	return browser && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Reactive so the settings control tracks the live choice. */
export const theme = $state<{ pref: ThemePref }>({ pref: read() });

function apply(pref: ThemePref): void {
	if (!browser) return;
	const root = document.documentElement;
	// 'system' means "no override" — let the OS drive through the media query.
	if (pref === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', pref);
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', resolvesDark(pref) ? DARK_PAPER : LIGHT_PAPER);
}

export function setTheme(pref: ThemePref): void {
	theme.pref = pref;
	if (!browser) return;
	if (pref === 'system') localStorage.removeItem(KEY);
	else localStorage.setItem(KEY, pref);
	apply(pref);
}

// While on 'system', an OS theme flip repaints the tokens on its own (the media
// query), but the status-bar colour needs a nudge.
if (browser) {
	matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (theme.pref === 'system') apply('system');
	});
}
