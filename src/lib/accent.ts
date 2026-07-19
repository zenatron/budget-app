/**
 * Workspace accent colors. A workspace stores its own `accent_color`; when it
 * has none (workspaces created before the picker existed), we derive a stable
 * one from the slug so the same workspace always looks the same.
 *
 * Shared because the layout, the welcome page, and the settings picker must all
 * agree — a second copy of this list is a second theme.
 */
/*
 * These started as the iOS system colours — but those are tuned for a *dark*
 * background, and this app is light warm paper throughout. The bright ones
 * measured 1.2–1.8:1 against --paper, where the rest of the set sits around
 * 3:1, so green, turquoise and yellow have been darkened to match the cohort.
 * Same hue, lower lightness. A yellow legible on cream is necessarily an ochre.
 *
 * If you add one, check it against --paper before committing: on this
 * background, "vivid" and "invisible" are close neighbours.
 */
export const ACCENTS = [
	'#FF9F0A',
	'#FF375F',
	'#0D9E3A',
	'#0A84FF',
	'#BF5AF2',
	'#FF453A',
	'#1795A9',
	'#A0860C',
	'#B4472B'
] as const;

/**
 * Display names, in palette order. Presentation only — a workspace stores the
 * hex, never the name, so renaming one is a copy change and nothing more.
 */
export const ACCENT_NAMES: Record<string, string> = {
	'#FF9F0A': 'Tangerine',
	'#FF375F': 'Magenta',
	'#0D9E3A': 'Evergreen',
	'#0A84FF': 'Azure',
	'#BF5AF2': 'Lilac',
	'#FF453A': 'Crimson',
	'#1795A9': 'Cerulean',
	'#A0860C': 'Peanut',
	'#B4472B': 'Cinnamon'
};

export function accentName(hex: string): string {
	return ACCENT_NAMES[hex.toUpperCase()] ?? hex;
}

/** Retired brights, mapped to their replacements — see scripts/restyle-accents.ts. */
export const RETIRED_ACCENTS: Record<string, string> = {
	'#30D158': '#0D9E3A',
	'#40C8E0': '#1795A9',
	'#FFD60A': '#A0860C'
};

export function accentFor(ws: { slug: string; accentColor?: string | null }): string {
	if (ws.accentColor) return ws.accentColor;
	const hash = ws.slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
	return ACCENTS[hash % ACCENTS.length];
}
