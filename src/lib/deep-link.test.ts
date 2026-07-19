import { describe, expect, it } from 'vitest';
import { resolveDeepLink } from './deep-link';

const ORIGIN = 'https://ledger.example.com';
const at = (p: Parameters<typeof resolveDeepLink>[0]) => resolveDeepLink(p, ORIGIN);

describe('resolveDeepLink', () => {
	it('passes a plain path through', () => {
		expect(at({ path: '/w/acme/purchases/123' })).toBe('/w/acme/purchases/123');
	});

	it('keeps query and hash', () => {
		expect(at({ path: '/w/acme/analytics?period=year#top' })).toBe(
			'/w/acme/analytics?period=year#top'
		);
	});

	it('repairs a legacy payload baked against localhost', () => {
		// The bug this exists for: PUBLIC_ORIGIN defaulted to localhost, so
		// notifications already delivered to phones pointed at a dead address.
		expect(at({ url: 'http://localhost:3000/w/acme/purchases/123' })).toBe('/w/acme/purchases/123');
	});

	it('strips any foreign origin rather than navigating off-site', () => {
		expect(at({ url: 'https://evil.example/steal?a=1' })).toBe('/steal?a=1');
	});

	it('prefers path over a legacy url when both are present', () => {
		expect(at({ path: '/right', url: 'http://localhost:3000/wrong' })).toBe('/right');
	});

	it('falls back to the root for empty or unusable input', () => {
		expect(at({})).toBe('/');
		expect(at({ path: '' })).toBe('/');
	});
});
