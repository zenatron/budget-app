import { describe, expect, it } from 'vitest';
import { createUuidv7Generator } from './uuidv7';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
	it('produces valid v7 UUIDs', () => {
		const gen = createUuidv7Generator();
		for (let i = 0; i < 100; i++) {
			expect(gen.newId()).toMatch(UUID_RE);
		}
	});

	it('encodes the timestamp in the first 48 bits', () => {
		const ts = 1_700_000_000_000;
		const gen = createUuidv7Generator(() => ts);
		const id = gen.newId().replaceAll('-', '');
		expect(parseInt(id.slice(0, 12), 16)).toBe(ts);
	});

	it('is monotonic within the same millisecond', () => {
		const gen = createUuidv7Generator(() => 1_700_000_000_000);
		const ids = Array.from({ length: 500 }, () => gen.newId());
		const sorted = [...ids].sort();
		expect(ids).toEqual(sorted);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('sorts across milliseconds', () => {
		let ms = 1_700_000_000_000;
		const gen = createUuidv7Generator(() => ms);
		const a = gen.newId();
		ms += 5;
		const b = gen.newId();
		expect(a < b).toBe(true);
	});
});
