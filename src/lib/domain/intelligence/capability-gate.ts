/**
 * May we offer a feature that needs a particular model capability?
 *
 * Three answers, not two, because we genuinely have three states — and the
 * difference between the second and the third is the whole reason
 * `ModelEntry.capabilities` is `string[] | null` rather than `string[]`.
 *
 * | What we know                   | Answer                                    |
 * | ------------------------------ | ----------------------------------------- |
 * | The model claims the capability| Offer it.                                 |
 * | We asked, and it does not      | Hide it, and say which model to pick.     |
 * | We never established anything  | **Offer it and attempt it.**              |
 *
 * The third row is the one worth arguing about. Failing *closed* on unknown
 * would be the cautious-looking choice and it would be wrong: no
 * OpenAI-compatible endpoint exposes anything like `/api/show` — `/v1/models`
 * returns names — and pre-0.6 Ollama did not report capabilities either. Failing
 * closed would therefore withdraw the feature from every External user and every
 * older local server on the strength of something we never learned. So we try,
 * and when it fails the user sees the provider's own error, which says more than
 * any guess of ours would.
 *
 * The explicitly rejected alternative is a static `model name -> capabilities`
 * table. It would rot the day a provider ships a new model, and it would state
 * as fact something we never observed — precisely the failure the null/empty
 * distinction exists to prevent.
 *
 * `certain` is carried on the allow so callers can *say* which of the two allows
 * they got ("this may not work — we can't tell what your provider supports")
 * without having to re-derive it.
 *
 * Pure, and the single place this rule is written down.
 */

import { hasCapability, type ModelEntry } from './model-catalog';

export type Gate =
	/** Go ahead. `certain` is false when we are fail-open on an unknown. */
	| { allowed: true; certain: boolean }
	/** Don't offer it. `reason` is user-facing and names a way forward. */
	| { allowed: false; reason: string };

/**
 * Decide `cap` for `entry`. A null entry means no model is selected, or none we
 * have a catalog row for — which is unknown, not incapable, so it fails open
 * exactly like an unintrospectable one.
 */
export function gateFor(entry: ModelEntry | null, cap: string): Gate {
	if (!entry || entry.capabilities === null) return { allowed: true, certain: false };
	if (hasCapability(entry, cap)) return { allowed: true, certain: true };
	return {
		allowed: false,
		reason: `${entry.name} can't ${capabilityVerb(cap)} — pick a model with the ${cap} chip.`
	};
}

/** How to say a capability in a sentence. Falls back to the bare name. */
function capabilityVerb(cap: string): string {
	switch (cap) {
		case 'vision':
			return 'read images';
		case 'tools':
			return 'use tools';
		case 'thinking':
			return 'show its reasoning';
		case 'embedding':
			return 'produce embeddings';
		default:
			return cap;
	}
}

/**
 * The catalog row for `model`, or null when there isn't one. External providers
 * have no catalog at all, so this is how they arrive at the unknown branch:
 * an empty list is not evidence of incapability.
 */
export function entryFor(
	models: ModelEntry[] | null | undefined,
	model: string | null
): ModelEntry | null {
	if (!models || !model) return null;
	return models.find((m) => m.name === model) ?? null;
}
