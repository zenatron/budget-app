<script lang="ts">
	/**
	 * Weekday toggles as 44px chips. The old checkbox row put seven ~16px targets
	 * in a line, which on a phone is a coin toss.
	 *
	 * Values are ISO weekday numbers (Mon = 1 … Sun = 7), matching the rrule
	 * module's `byDay`.
	 */
	let { value = $bindable(), name }: { value: number[]; name?: string } = $props();

	const days = [
		{ n: 1, label: 'M', full: 'Monday' },
		{ n: 2, label: 'T', full: 'Tuesday' },
		{ n: 3, label: 'W', full: 'Wednesday' },
		{ n: 4, label: 'T', full: 'Thursday' },
		{ n: 5, label: 'F', full: 'Friday' },
		{ n: 6, label: 'S', full: 'Saturday' },
		{ n: 7, label: 'S', full: 'Sunday' }
	];

	function toggle(n: number) {
		value = value.includes(n) ? value.filter((d) => d !== n) : [...value, n].sort((a, b) => a - b);
	}
</script>

<span class="section-label mb-1.5 block">Repeats on</span>
<div class="flex justify-between gap-1">
	{#each days as d (d.n)}
		{@const active = value.includes(d.n)}
		<button
			type="button"
			role="checkbox"
			aria-checked={active}
			aria-label={d.full}
			onclick={() => toggle(d.n)}
			class="press flex h-11 flex-1 items-center justify-center rounded-full text-[14px] transition-colors"
			style="color: {active ? 'var(--paper)' : 'var(--ink-2)'}; background: {active
				? 'var(--ink)'
				: 'var(--surface-2)'}; font-weight: {active ? '700' : '500'}"
		>
			{d.label}
		</button>
	{/each}
</div>
{#if name}
	{#each value as n (n)}
		<input type="hidden" {name} value={n} />
	{/each}
{/if}
