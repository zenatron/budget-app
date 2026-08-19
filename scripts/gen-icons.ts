/** One-off: renders the app icon set into static/. Committed output; rerun on redesign. */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

function iconSvg(size: number, padded: boolean): string {
	// Dark rounded tile, single accent: a minimal coin with a slot.
	const pad = padded ? size * 0.12 : 0;
	const inner = size - pad * 2;
	const r = padded ? 0 : size * 0.22;
	const coinR = inner * 0.3;
	const cx = size / 2;
	const cy = size / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
	<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="#0a0a0a"/>
	<circle cx="${cx}" cy="${cy}" r="${coinR}" fill="none" stroke="#4ade80" stroke-width="${inner * 0.055}"/>
	<line x1="${cx}" y1="${cy - coinR * 0.55}" x2="${cx}" y2="${cy + coinR * 0.55}" stroke="#4ade80" stroke-width="${inner * 0.055}" stroke-linecap="round"/>
</svg>`;
}

// The "New purchase" manifest shortcut: the same coin, with the slot turned
// into a plus. Shortcut glyphs render tiny — a bold stroke on the familiar
// tile beats a new composition nobody can read at 48px.
function shortcutSvg(size: number): string {
	const r = size * 0.22;
	const coinR = size * 0.28;
	const cx = size / 2;
	const cy = size / 2;
	const arm = coinR * 0.62;
	const stroke = size * 0.07;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
	<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="#0a0a0a"/>
	<circle cx="${cx}" cy="${cy}" r="${coinR}" fill="none" stroke="#4ade80" stroke-width="${stroke}"/>
	<line x1="${cx - arm}" y1="${cy}" x2="${cx + arm}" y2="${cy}" stroke="#4ade80" stroke-width="${stroke}" stroke-linecap="round"/>
	<line x1="${cx}" y1="${cy - arm}" x2="${cx}" y2="${cy + arm}" stroke="#4ade80" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>`;
}

await mkdir('static/icons', { recursive: true });
const jobs: [string, number, boolean][] = [
	['static/icons/icon-192.png', 192, false],
	['static/icons/icon-512.png', 512, false],
	['static/icons/maskable-512.png', 512, true],
	['static/icons/apple-touch-icon.png', 180, false]
];
for (const [path, size, padded] of jobs) {
	await sharp(Buffer.from(iconSvg(size, padded)))
		.png()
		.toFile(path);
	console.log('wrote', path);
}

await sharp(Buffer.from(shortcutSvg(96)))
	.png()
	.toFile('static/icons/shortcut-new-96.png');
console.log('wrote', 'static/icons/shortcut-new-96.png');
