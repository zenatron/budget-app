import { describe, it, expect } from 'vitest';
import { gateFor, entryFor } from './capability-gate';
import type { ModelEntry } from './model-catalog';

const entry = (over: Partial<ModelEntry> = {}): ModelEntry => ({
	name: 'gemma4:latest',
	modifiedAt: '2026-08-01T00:00:00Z',
	capabilities: null,
	...over
});

describe('gateFor — the three states', () => {
	it('allows, with certainty, a model that claims the capability', () => {
		expect(gateFor(entry({ capabilities: ['completion', 'vision'] }), 'vision')).toEqual({
			allowed: true,
			certain: true
		});
	});

	it('refuses a model we asked about that does not have it', () => {
		const gate = gateFor(
			entry({ name: 'granite4.1:8b', capabilities: ['completion', 'tools'] }),
			'vision'
		);

		expect(gate.allowed).toBe(false);
		expect(gate.allowed === false && gate.reason).toBe(
			"granite4.1:8b can't read images. Pick a model with the vision chip."
		);
	});

	it('fails open when capabilities were never established', () => {
		expect(gateFor(entry({ capabilities: null }), 'vision')).toEqual({
			allowed: true,
			certain: false
		});
	});

	it('distinguishes “established and none” from “never established”', () => {
		// The whole reason capabilities is `string[] | null`: an empty array is a
		// claim, and it must refuse where null must not.
		expect(gateFor(entry({ capabilities: [] }), 'vision').allowed).toBe(false);
		expect(gateFor(entry({ capabilities: null }), 'vision').allowed).toBe(true);
	});

	it('fails open with no model at all — External has no catalog to consult', () => {
		expect(gateFor(null, 'vision')).toEqual({ allowed: true, certain: false });
	});
});

describe('gateFor — the refusal names a way forward', () => {
	it.each([
		['vision', "can't read images"],
		['tools', "can't use tools"],
		['thinking', "can't show its reasoning"],
		['embedding', "can't produce embeddings"],
		['insert', "can't insert"]
	])('phrases %s readably', (cap, phrase) => {
		const gate = gateFor(entry({ name: 'm', capabilities: ['completion'] }), cap);
		expect(gate.allowed === false && gate.reason).toContain(phrase);
		expect(gate.allowed === false && gate.reason).toContain(`the ${cap} chip`);
	});
});

describe('entryFor', () => {
	const models = [entry({ name: 'a' }), entry({ name: 'b', capabilities: ['vision'] })];

	it('finds the selected model’s row', () => {
		expect(entryFor(models, 'b')?.capabilities).toEqual(['vision']);
	});

	it('is null — not incapable — for a model, list, or selection we do not have', () => {
		expect(entryFor(models, 'c')).toBeNull();
		expect(entryFor(models, null)).toBeNull();
		expect(entryFor(null, 'b')).toBeNull();
		expect(entryFor([], 'b')).toBeNull();
	});

	it('composes with gateFor so an unlisted model fails open', () => {
		expect(gateFor(entryFor(models, 'not-listed'), 'vision')).toEqual({
			allowed: true,
			certain: false
		});
	});
});
