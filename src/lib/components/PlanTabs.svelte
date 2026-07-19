<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Sub-navigation for the Plan tab. Recurring charges and buckets are both
	 * money already claimed before anything discretionary — a subscription and a
	 * standing transfer to the travel fund are the same shape from a budgeting
	 * view — so they share a tab.
	 *
	 * Real links rather than a client-side toggle: each keeps its own route, load
	 * and actions, and stays independently bookmarkable.
	 */
	let slug = $derived(page.params.workspace);
	let current = $derived(page.url.pathname.includes('/buckets') ? 'buckets' : 'recurring');

	const items = [
		{ key: 'recurring', label: 'Recurring', hint: 'Bills & subscriptions' },
		{ key: 'buckets', label: 'Buckets', hint: 'Set aside each month' }
	];
</script>

<div class="mb-4 flex justify-center">
	<div class="inline-flex rounded-[12px] p-1" style="background: var(--surface-2)" role="tablist">
		{#each items as item (item.key)}
			{@const active = current === item.key}
			<a
				href="/w/{slug}/{item.key}"
				role="tab"
				aria-selected={active}
				title={item.hint}
				class="press rounded-[9px] px-5 py-2 text-[14px] font-semibold transition-colors"
				style="color: {active ? 'var(--ink)' : 'var(--ink-3)'}; background: {active
					? 'var(--surface)'
					: 'transparent'}; box-shadow: {active
					? 'var(--shadow-card), inset 0 0 0 0.5px var(--hairline)'
					: 'none'}"
			>
				{item.label}
			</a>
		{/each}
	</div>
</div>
