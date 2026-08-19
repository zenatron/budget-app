<script lang="ts">
	/**
	 * A placeholder in the exact shape of a ledger row — 40px icon square, two
	 * text lines, optional trailing amount — so "Show more" fills with the
	 * shape of what's coming rather than a spinner and a growing void. Only
	 * ever a handful of rows: a skeleton list as long as the page it imitates
	 * would be theatre, not information.
	 *
	 * Widths are fixed percentages of the row, not measured from the data:
	 * skeletons that matched the incoming content exactly would be a lie told
	 * precisely. Generic mid-length lines read as "rows are coming", which is
	 * all a skeleton owes anyone.
	 */
	let {
		lines = 2,
		trailing = true,
		last = false
	}: { lines?: number; trailing?: boolean; last?: boolean } = $props();
</script>

<div class="flex items-center gap-3 px-1 py-3 {last ? '' : 'hairline'}" aria-hidden="true">
	<div class="skeleton h-10 w-10 shrink-0 rounded-[12px]"></div>
	<div class="flex min-w-0 flex-1 flex-col gap-1.5">
		{#each Array(lines) as _, i (i)}
			<div class="skeleton h-3.5" style="max-width: {i === 0 ? 62 : 38}%"></div>
		{/each}
	</div>
	{#if trailing}
		<div class="skeleton h-3.5 w-14 shrink-0"></div>
	{/if}
</div>
