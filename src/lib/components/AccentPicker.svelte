<script lang="ts">
	import { ACCENTS, accentName } from '$lib/accent';
	import { Check } from '@lucide/svelte';

	let { value = $bindable(), label = 'Accent color' }: { value: string; label?: string } = $props();

	// Show the swatch as it will actually render — the accent is auto-lifted in
	// dark, so the picker previews that lift rather than the stored (light-tuned) hex.
	const lift = (c: string) => `light-dark(${c}, color-mix(in oklch, ${c}, white 18%))`;
</script>

<!--
	Swatches are 44×44 hit targets (Apple's HIG minimum) with the color drawn at
	30px inside. The previous grid packed 9 swatches into a 2.5px-gap cluster,
	which on a phone is one big ambiguous tap zone.
-->
<fieldset class="min-w-0">
	<legend class="section-label mb-2">{label}</legend>
	<div class="flex flex-wrap gap-1">
		{#each ACCENTS as c (c)}
			{@const selected = c === value}
			<button
				type="button"
				onclick={() => (value = c)}
				class="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
				aria-label={selected ? `${accentName(c)}, selected` : `Use ${accentName(c)}`}
				title={accentName(c)}
				aria-pressed={selected}
			>
				<span
					class="flex items-center justify-center rounded-full transition-all duration-150"
					style="background: {lift(c)}; width: {selected ? '30px' : '26px'}; height: {selected
						? '30px'
						: '26px'}; box-shadow: {selected
						? `0 0 0 2px var(--surface), 0 0 0 4px ${lift(c)}`
						: 'inset 0 0 0 1px light-dark(oklch(0 0 0 / 0.08), oklch(1 0 0 / 0.14))'}"
				>
					{#if selected}
						<Check class="h-3.5 w-3.5 text-white" />
					{/if}
				</span>
			</button>
		{/each}
	</div>
	<!--
		Names the current pick rather than labelling all nine — nine captions under
		nine swatches is more text than colour. Each swatch still carries its name
		in aria-label and title, so nothing is only available to the eye.
	-->
	<p class="mt-2 text-[13px]" style="color: var(--ink-3)">{accentName(value)}</p>
</fieldset>
