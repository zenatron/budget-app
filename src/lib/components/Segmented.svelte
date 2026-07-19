<script lang="ts">
	/**
	 * Segmented control. Replaces <select> where the options are few and the
	 * choice steers the rest of a form — a dropdown hides the alternatives behind
	 * a tap, which is what made the recurrence forms feel like a guessing game.
	 */
	let {
		value = $bindable(),
		options,
		label,
		name
	}: {
		value: string;
		options: { value: string; label: string }[];
		label?: string;
		name?: string;
	} = $props();
</script>

{#if label}
	<span class="section-label mb-1.5 block">{label}</span>
{/if}
<div
	class="inline-flex w-full rounded-[12px] p-1"
	style="background: var(--surface-2)"
	role="radiogroup"
	aria-label={label}
>
	{#each options as opt (opt.value)}
		{@const active = value === opt.value}
		<button
			type="button"
			role="radio"
			aria-checked={active}
			onclick={() => (value = opt.value)}
			class="press flex-1 rounded-[9px] py-2 text-[14px] font-semibold transition-colors"
			style="color: {active ? 'var(--ink)' : 'var(--ink-3)'}; background: {active
				? 'var(--surface)'
				: 'transparent'}; box-shadow: {active
				? 'var(--shadow-card), inset 0 0 0 0.5px var(--hairline)'
				: 'none'}"
		>
			{opt.label}
		</button>
	{/each}
</div>
{#if name}
	<input type="hidden" {name} {value} />
{/if}
