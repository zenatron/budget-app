<script lang="ts">
	import { requestConfirm } from '$lib/confirm-state.svelte';

	// Imported at click time, not at module scope. A static import here reaches
	// $lib/demo/db and drags the whole PGlite WASM runtime into the production
	// workspace layout — the `{#if __DEMO__}` guard removes the *usage*, not the
	// module from the graph.

	let resetting = $state(false);

	async function reset() {
		const ok = await requestConfirm({
			title: 'Reset the demo?',
			body: 'Everything you have changed goes back to the sample data.',
			confirmLabel: 'Reset'
		});
		if (!ok) return;
		resetting = true;
		const [{ resetDemoDb }, { clearDemoContext }] = await Promise.all([
			import('$lib/demo/db'),
			import('$lib/demo/context')
		]);
		await resetDemoDb();
		clearDemoContext();
		// A full reload rather than invalidateAll: the loads have already closed
		// over the old database handle, and nothing should survive the reset.
		location.reload();
	}
</script>

<aside class="demo-banner">
	<p>
		<strong>Demo.</strong> Everything runs in your browser — no account, no server. Changes are saved
		locally and never leave this device.
	</p>
	<button type="button" onclick={reset} disabled={resetting}>
		{resetting ? 'Resetting…' : 'Reset demo'}
	</button>
</aside>

<style>
	.demo-banner {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs) var(--space-md);
		align-items: center;
		justify-content: center;
		padding: var(--space-xs) var(--space-md);
		background: var(--surface-2);
		border-bottom: 1px solid var(--hairline);
		font-size: 0.8125rem;
		line-height: 1.35;
		color: var(--ink-3);
	}

	.demo-banner p {
		margin: 0;
		text-align: center;
	}

	.demo-banner strong {
		color: var(--ink);
	}

	.demo-banner button {
		padding: var(--space-2xs) var(--space-sm);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-full);
		background: transparent;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}

	.demo-banner button:hover:not(:disabled) {
		background: var(--surface-hi);
	}

	.demo-banner button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
