import { describe, it, expect } from 'vitest';
import { annotationsFor, CLASSIFIED } from './annotations';
import { TOOLS } from './tools';

const names = new Set(TOOLS.map((t) => t.name));

describe('every tool is classified', () => {
	it('names only real tools in the classification sets', () => {
		// A rename that forgets these sets silently downgrades a destructive tool
		// to whatever the default happens to be. Catch it here instead.
		for (const n of [...CLASSIFIED.SAFE_WRITES, ...CLASSIFIED.IDEMPOTENT_WRITES]) {
			expect(names, `${n} is classified but is not a tool`).toContain(n);
		}
	});

	it('gives every tool a complete set of hints', () => {
		for (const t of TOOLS) {
			const a = annotationsFor(t);
			expect(Object.keys(a).sort()).toEqual([
				'destructiveHint',
				'idempotentHint',
				'openWorldHint',
				'readOnlyHint'
			]);
		}
	});
});

describe('read tools', () => {
	it('are read-only, idempotent and never destructive', () => {
		for (const t of TOOLS.filter((t) => t.scope === 'read')) {
			const a = annotationsFor(t);
			expect(a, t.name).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true
			});
		}
	});
});

describe('writing tools', () => {
	it('are never marked read-only', () => {
		for (const t of TOOLS.filter((t) => t.scope !== 'read')) {
			expect(annotationsFor(t).readOnlyHint, t.name).toBe(false);
		}
	});

	it('default to destructive, so an unclassified new tool is treated with caution', () => {
		// The safe direction: forgetting to classify makes a client ask, rather
		// than making it assume the call is harmless.
		expect(annotationsFor({ name: 'some_tool_nobody_classified', scope: 'write' })).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false
		});
	});

	it.each([
		['log_purchase', false],
		['request_purchase', false],
		['create_bucket', false],
		['add_income', false],
		// Flips straight back; prompting here would only train people to click
		// through the prompt that guards move_bucket_money.
		['pause_bucket', false],
		['resume_bucket', false],
		// These change or reveal something that already existed.
		['move_bucket_money', true],
		['delete_income', true],
		['unseal_purchase', true],
		['edit_purchase', true],
		['refund_purchase', true],
		['cancel_purchase', true]
	])('marks %s destructive=%s', (name, destructive) => {
		const tool = TOOLS.find((t) => t.name === name)!;
		expect(tool, `${name} no longer exists`).toBeDefined();
		expect(annotationsFor(tool).destructiveHint).toBe(destructive);
	});
});

describe('nothing is open-world', () => {
	it('never claims an outside party is involved', () => {
		// Every tool acts on this workspace's own database. If one ever reaches
		// the internet, this test should be the thing that objects.
		for (const t of TOOLS) {
			expect(annotationsFor(t).openWorldHint, t.name).toBe(false);
		}
	});
});
