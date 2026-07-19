/**
 * Workspace accent colors. A workspace stores its own `accent_color`; when it
 * has none (workspaces created before the picker existed), we derive a stable
 * one from the slug so the same workspace always looks the same.
 *
 * Shared because the layout, the welcome page, and the settings picker must all
 * agree — a second copy of this list is a second theme.
 */
export const ACCENTS = [
	'#FF9F0A',
	'#FF375F',
	'#30D158',
	'#0A84FF',
	'#BF5AF2',
	'#FF453A',
	'#40C8E0',
	'#FFD60A',
	'#B4472B'
] as const;

export function accentFor(ws: { slug: string; accentColor?: string | null }): string {
	if (ws.accentColor) return ws.accentColor;
	const hash = ws.slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
	return ACCENTS[hash % ACCENTS.length];
}
