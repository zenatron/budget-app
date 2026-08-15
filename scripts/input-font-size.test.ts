import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 16px floor on anything you type into, enforced.
 *
 * Mobile Safari zooms the viewport when a focused form control is smaller than
 * 16px, and does not zoom back out. In an installed PWA that reads as the whole
 * layout lurching sideways under a thumb, on the tap that was meant to start
 * typing — and it is invisible on a desktop browser, on every emulator, and in
 * every screenshot taken on this machine. It is only ever found by holding a
 * phone, which is why it drifted back into seven fields between reviews.
 *
 * So it is checked here instead of remembered. The rule is mechanical: a form
 * control that takes text must not carry a font size under 16px, whether it
 * comes from a utility class, an inline style, or a CSS rule that targets one.
 *
 * This is a lint, not a unit test. It lives in `scripts/` for that reason, and
 * runs in `npm test` because that is what actually gets run here.
 */

const ROOT = new URL('..', import.meta.url).pathname;
const MIN_PX = 16;

/** Controls with no text to zoom into. A checkbox has no font size that matters. */
const EXEMPT_TYPES = new Set([
	'hidden',
	'checkbox',
	'radio',
	'range',
	'color',
	'file',
	'submit',
	'button',
	'image',
	'reset'
]);

/** Tailwind's named sizes, for the ones that resolve below the floor. */
const NAMED_PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16 };

function walk(dir: string, ext: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, ext, out);
		else if (full.endsWith(ext)) out.push(full);
	}
	return out;
}

/**
 * The opening tag starting at `from`, as source text.
 *
 * A regex can't do this: Svelte attributes hold arbitrary expressions, and
 * `onkeydown={(e) => …}` contains the `>` that a naive `[^>]*>` would stop at —
 * which silently truncates the tag and makes the check pass by not looking.
 */
function readTag(src: string, from: number): string {
	let depth = 0;
	let quote: string | null = null;
	for (let i = from; i < src.length; i++) {
		const c = src[i];
		if (quote) {
			if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		else if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (c === '>' && depth === 0) return src.slice(from, i + 1);
	}
	return src.slice(from);
}

function attr(tag: string, name: string): string | null {
	return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Every font size a tag declares, from utility classes and inline styles alike. */
function declaredSizes(tag: string): number[] {
	const sizes: number[] = [];
	const cls = attr(tag, 'class') ?? '';
	for (const m of cls.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) sizes.push(Number(m[1]));
	for (const [name, px] of Object.entries(NAMED_PX)) {
		if (new RegExp(`(^|\\s)${name}(\\s|$)`).test(cls)) sizes.push(px);
	}
	const style = attr(tag, 'style') ?? '';
	for (const m of style.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) sizes.push(Number(m[1]));
	return sizes;
}

interface Offence {
	where: string;
	what: string;
}

function scanMarkup(file: string): Offence[] {
	const src = readFileSync(file, 'utf8');
	const rel = file.slice(ROOT.length);
	const out: Offence[] = [];
	for (const m of src.matchAll(/<(input|textarea|select)(?=[\s/>])/g)) {
		const tag = readTag(src, m.index);
		const type = attr(tag, 'type');
		if (type && EXEMPT_TYPES.has(type)) continue;
		const line = src.slice(0, m.index).split('\n').length;
		for (const px of declaredSizes(tag)) {
			if (px < MIN_PX) out.push({ where: `${rel}:${line}`, what: `<${m[1]}> at ${px}px` });
		}
	}
	return out;
}

/**
 * CSS rules that dress a form control. `.ledger-input` set 16px correctly and
 * was then overridden to 15px at one call site — both halves of that are worth
 * catching, so the selector check and the markup check both run.
 */
const CONTROL_SELECTOR = /(^|[\s,])(input|textarea|select)\b|\.field\b|-input\b|-field\b/;

function scanCss(file: string): Offence[] {
	// Comments out, newlines kept: a block comment above a rule would otherwise
	// be read as part of its selector and reported as the offending code.
	const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
		'\n'.repeat((c.match(/\n/g) ?? []).length)
	);
	const rel = file.slice(ROOT.length);
	const out: Offence[] = [];
	for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [, selector, body] = m;
		if (!CONTROL_SELECTOR.test(selector)) continue;
		const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(body);
		if (!size || Number(size[1]) >= MIN_PX) continue;
		const line = src.slice(0, m.index).split('\n').length;
		out.push({
			where: `${rel}:${line}`,
			what: `${selector.trim().replace(/\s+/g, ' ')} at ${size[1]}px`
		});
	}
	return out;
}

describe('form controls stay at or above 16px', () => {
	const svelte = walk(join(ROOT, 'src'), '.svelte');
	const css = [...walk(join(ROOT, 'src'), '.css'), ...walk(join(ROOT, 'src'), '.svelte')];

	it('finds files to check, so a broken glob cannot pass silently', () => {
		expect(svelte.length).toBeGreaterThan(20);
	});

	it('has no text input rendered below the iOS zoom threshold', () => {
		const offences = svelte.flatMap(scanMarkup);
		expect(offences.map((o) => `${o.where} — ${o.what}`)).toEqual([]);
	});

	it('has no stylesheet putting a form control below it either', () => {
		const offences = css.flatMap(scanCss);
		expect(offences.map((o) => `${o.where} — ${o.what}`)).toEqual([]);
	});

	it('actually catches an offence, so a green result means something', () => {
		// A check that cannot fail is decoration. This is the shape of the bug it
		// exists to stop: `.field` re-declared smaller at the call site.
		const tag = readTag('<input class="field w-full text-[15px]" />', 0);
		expect(declaredSizes(tag)).toEqual([15]);
		expect(declaredSizes(readTag('<input class="field" />', 0))).toEqual([]);
		// And it must see past an attribute holding a `>` in an expression.
		const withArrow = readTag('<input onkeydown={(e) => go(e)} class="text-sm" />', 0);
		expect(declaredSizes(withArrow)).toEqual([14]);
	});
});
