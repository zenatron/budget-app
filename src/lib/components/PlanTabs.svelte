<script lang="ts">
	import { page } from '$app/state';
	import { CalendarDays } from '@lucide/svelte';

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

<!--
	The pill stays centred; the calendar sits beside it rather than in it. A third
	tab would have said the calendar is a sibling of Recurring and Buckets, and it
	isn't — it's a view *across* both, which is why it reads as an action.
-->
<div class="relative mb-4 flex justify-center">
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
	<a
		href="/w/{slug}/calendar"
		class="press absolute top-1/2 right-0 flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-[var(--r-sm)]"
		style="box-shadow: inset 0 0 0 1px var(--hairline); background: var(--surface)"
		aria-label="Month calendar"
		title="What's coming, by day"
	>
		<CalendarDays class="h-4 w-4" style="color: var(--ink-3)" />
	</a>
</div>
