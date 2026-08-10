/**
 * Carries a file from the bill reader to the reconcile screen.
 *
 * The bill reader can tell a statement from a bill, and says so rather than
 * failing — but "go to Reconcile and pick it again" is a redirect that makes the
 * person do the work twice, having already told us exactly which file they mean.
 *
 * A `File` cannot travel in a URL and has no business in a store that outlives
 * the trip, so this is deliberately the smallest thing that works: one slot, set
 * on the way out, **taken** (not read) on the way in, and empty again the moment
 * it has been used. Client-side navigation preserves module state, which is the
 * only reason this is possible at all; a hard reload loses it, and the reconcile
 * screen's own file picker is right there, so losing it costs nothing.
 */

let pending: File | null = null;

/** Hand a file to whoever navigates to Reconcile next. */
export function handOff(file: File): void {
	pending = file;
}

/** Take the handed-off file, if there is one. Leaves the slot empty. */
export function takeHandoff(): File | null {
	const f = pending;
	pending = null;
	return f;
}
