<script lang="ts">
	import { ACCENTS } from '$lib/accent';
	import Icon from '$lib/components/Icon.svelte';

	let { value = $bindable(), label = 'Accent color' }: { value: string; label?: string } = $props();
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
				aria-label={selected ? `Accent ${c}, selected` : `Use accent ${c}`}
				aria-pressed={selected}
			>
				<span
					class="flex items-center justify-center rounded-full transition-all duration-150"
					style="background: {c}; width: {selected ? '30px' : '26px'}; height: {selected
						? '30px'
						: '26px'}; box-shadow: {selected
						? `0 0 0 2px var(--surface), 0 0 0 4px ${c}`
						: 'inset 0 0 0 1px oklch(0 0 0 / 0.08)'}"
				>
					{#if selected}
						<Icon name="checkmark" class="h-3.5 w-3.5 text-white" />
					{/if}
				</span>
			</button>
		{/each}
	</div>
</fieldset>
