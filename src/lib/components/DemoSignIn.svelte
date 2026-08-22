<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	// The demo's answer to "Sign in with Pocket ID". There is no identity
	// provider behind the static build, so the landing page says what the button
	// actually does: it opens the seeded workspace as its owner.
	//
	// Imported at click and mount time, not at module scope. A static import
	// here reaches $lib/demo/context and drags the whole PGlite WASM runtime into
	// the landing page's bundle, which in production has no use for it. Same
	// reason DemoBanner defers its import.

	let entry = $state<string | null>(null);
	let checked = $state(false);
	let working = $state(false);

	onMount(async () => {
		const { findDemoEntrySlug } = await import('$lib/demo/context');
		entry = await findDemoEntrySlug(base);
		checked = true;
	});

	async function open() {
		if (!entry) return;
		working = true;
		const { signIn } = await import('$lib/demo/session');
		signIn();
		await goto(`${base}/w/${entry}/purchases`);
	}

	// Nothing left to open: every workspace has been deleted. Restoring is the
	// same reset the demo banner offers, so the sample data comes back exactly
	// as it shipped.
	async function restore() {
		working = true;
		const [{ resetDemoDb }, { signIn }] = await Promise.all([
			import('$lib/demo/db'),
			import('$lib/demo/session')
		]);
		signIn();
		await resetDemoDb();
		// A full reload rather than a goto: the root load has already run against
		// the emptied database, and nothing should survive the reset.
		location.reload();
	}
</script>

{#if checked && !entry}
	<button
		type="button"
		onclick={restore}
		disabled={working}
		class="btn btn-accent w-full py-4 text-[17px]"
	>
		{working ? 'Restoring…' : 'Restore the sample data'}
	</button>
	<p class="mt-4 text-center text-[13px]" style="color: var(--ink-3)">
		You deleted every workspace in this demo. Restoring brings the sample data back.
	</p>
{:else}
	<button
		type="button"
		onclick={open}
		disabled={!entry || working}
		class="btn btn-accent w-full py-4 text-[17px]"
	>
		<!--
			Three states, because two of them are waits the visitor can feel. The
			database behind this button is Postgres compiled to WASM, restored from
			a 5 MB snapshot on a first visit, and `checked` is false for all of it.
			A disabled button with no label change reads as a broken page.
		-->
		{#if working}Opening…{:else if checked}Open the demo{:else}Setting up…{/if}
	</button>
	<p class="mt-4 text-center text-[13px]" style="color: var(--ink-3)">
		{checked
			? 'No account needed. Everything runs in your browser.'
			: 'Loading the sample data into your browser.'}
	</p>
{/if}
