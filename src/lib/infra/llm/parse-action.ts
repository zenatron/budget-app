/**
 * Validate a model's raw JSON answer into one of the closed, safe actions the
 * command palette is allowed to prepare for confirmation. Anything that doesn't
 * fit the schema becomes null — a hallucination can only ever degrade to "no
 * suggestion", never to a wrong or destructive action.
 */

import * as v from 'valibot';
import type { ParsedAction } from '$lib/ports/llm-assist';

const ParsedActionSchema = v.variant('intent', [
	v.object({
		intent: v.literal('create_bucket'),
		name: v.pipe(v.string(), v.trim(), v.minLength(1)),
		amount: v.number(),
		dayOfMonth: v.optional(v.number(), 1)
	}),
	v.object({
		intent: v.literal('create_income'),
		source: v.pipe(v.string(), v.trim(), v.minLength(1)),
		amount: v.number(),
		monthly: v.optional(v.boolean(), false),
		dayOfMonth: v.optional(v.number(), 1)
	}),
	v.object({
		intent: v.literal('log_purchase')
	}),
	v.object({
		intent: v.literal('navigate'),
		target: v.picklist(['analytics', 'buckets', 'recurring', 'income', 'purchases', 'settings'])
	}),
	v.object({
		intent: v.literal('unknown')
	})
]);

export function parseActionJson(raw: string): ParsedAction | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const result = v.safeParse(ParsedActionSchema, parsed);
	if (!result.success) return null;
	return result.output as ParsedAction;
}
