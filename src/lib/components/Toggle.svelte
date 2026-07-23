<script lang="ts">
	import { untrack } from 'svelte';
	import { toastError } from '$lib/toast-state.svelte';

	/**
	 * The settings switch: an iOS-style pill that flips *optimistically* and
	 * persists in the background. The old version posted a form and waited for the
	 * round trip to redraw, so a slow save left the knob mid-air and disabled the
	 * control — the "glitch" this replaces. Here the knob moves the instant you
	 * tap; the write to the server follows, and only a genuine failure reverts it
	 * (with a toast). Settings are the source of truth in the DB; the UI just
	 * doesn't make you wait to see your own tap land.
	 *
	 * Geometry: track 44×28, knob 20, 4px inset so all four gaps match.
	 */
	const TRACK_W = 44;
	const KNOB = 20;
	const INSET = 4;
	const ON_X = TRACK_W - KNOB - INSET; // 20

	let {
		on,
		/** Page-relative form action to POST the new value to, e.g. "?/intelligence". */
		action,
		name = 'enabled',
		label,
		// The workspace accent, not a semantic colour: an enabled setting isn't an
		// "approved" state, so it must not borrow the green that reads as one.
		onColor = 'var(--accent)'
	}: {
		on: boolean;
		action: string;
		name?: string;
		label: string;
		onColor?: string;
	} = $props();

	// Seeded from the prop; the $effect below reseeds it on real prop changes.
	// svelte-ignore state_referenced_locally
	let checked = $state(on);
	let saving = false;

	// Reseed from server truth only when the incoming value actually changes (a
	// navigation, a workspace switch, an external update) — never mid-save, so our
	// optimistic value is never clobbered by the stale prop. `saving` is untracked
	// so flipping it doesn't re-run this and undo the optimistic state.
	$effect(() => {
		const next = on;
		if (!untrack(() => saving)) checked = next;
	});

	async function toggle() {
		const next = !checked;
		checked = next; // optimistic
		saving = true;
		try {
			const body = new FormData();
			body.set(name, String(next));
			const res = await fetch(action, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			if (!res.ok) throw new Error(String(res.status));
			const result = await res.json().catch(() => null);
			if (result && result.type === 'failure') throw new Error('failure');
		} catch {
			checked = !next; // revert
			toastError('Could not save that. Try again.');
		} finally {
			saving = false;
		}
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={toggle}
	class="press relative inline-flex h-7 w-11 items-center rounded-full transition-colors"
	style="background: {checked ? onColor : 'var(--surface-hi)'}"
>
	<span
		class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
		style="transform: translateX({checked ? `${ON_X}px` : `${INSET}px`})"
	></span>
</button>
