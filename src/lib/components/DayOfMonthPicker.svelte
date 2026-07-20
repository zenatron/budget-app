<script lang="ts">
	/**
	 * Day-of-month as a calendar-shaped grid rather than a 29-option <select>.
	 * Picking "the 15th" from a dropdown means scrolling a list of near-identical
	 * strings; here the number is where you'd expect it on a calendar.
	 *
	 * Goes to 31 like a real calendar. A day longer than a given month lands on
	 * that month's last day (the 30th → Feb 28), which is how bills fall; "Last
	 * day" is the separate "always the month end, whatever its length" choice.
	 */
	let {
		value = $bindable(),
		name,
		label = 'Day of month'
	}: { value: string; name?: string; label?: string } = $props();

	const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
</script>

<span class="section-label mb-1.5 block">{label}</span>
<div class="grid grid-cols-7 gap-1" role="radiogroup" aria-label={label}>
	{#each days as d (d)}
		{@const active = value === d}
		<button
			type="button"
			role="radio"
			aria-checked={active}
			onclick={() => (value = d)}
			class="press num flex h-9 items-center justify-center rounded-[9px] text-[14px] transition-colors"
			style="color: {active ? 'var(--paper)' : 'var(--ink-2)'}; background: {active
				? 'var(--ink)'
				: 'var(--surface-2)'}; font-weight: {active ? '700' : '500'}"
		>
			{d}
		</button>
	{/each}
</div>
<button
	type="button"
	role="radio"
	aria-checked={value === '-1'}
	onclick={() => (value = '-1')}
	class="press mt-1 h-9 w-full rounded-[9px] text-[14px] font-semibold transition-colors"
	style="color: {value === '-1' ? 'var(--paper)' : 'var(--ink-2)'}; background: {value === '-1'
		? 'var(--ink)'
		: 'var(--surface-2)'}"
>
	Last day of the month
</button>
{#if name}
	<input type="hidden" {name} {value} />
{/if}
