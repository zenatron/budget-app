<script lang="ts">
	import { formatMinor } from '$lib/money-format';
	import { EXAMPLE_PROMPTS } from '$lib/intelligence/parser';
	import Icon from '$lib/components/Icon.svelte';
	import {
		paletteQuery,
		paletteLoading,
		paletteResponse,
		paletteInputEl,
		close,
		submit,
		pickExample,
		handleKeydown
	} from '$lib/command-palette-state.svelte';

	let { currency = 'USD' }: { currency?: string } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	style="background: oklch(0 0 0 / 0.18)"
	onclick={close}
	onkeydown={() => {}}
></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-x-4 top-[20vh] z-50 mx-auto max-w-lg" onkeydown={handleKeydown}>
	<div
		class="card-lg overflow-hidden"
		style="box-shadow: var(--shadow-float); background: var(--surface)"
	>
		<div class="flex items-center gap-3 border-b px-4 py-3" style="border-color: var(--hairline)">
			<span
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
				style="background: color-mix(in oklab, var(--ws-accent) 16%, transparent)"
			>
				<Icon name="sparkle" class="h-4 w-4" style="color: var(--ws-accent)" />
			</span>
			<input
				bind:this={paletteInputEl.value}
				bind:value={paletteQuery.value}
				onkeydown={(e) => {
					if (e.key === 'Enter') submit();
				}}
				placeholder="Ask anything..."
				class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
				style="color: var(--ink)"
			/>
			<button
				onclick={submit}
				disabled={paletteLoading.value || !paletteQuery.value.trim()}
				class="press shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold"
				style="background: var(--ink); color: var(--paper); opacity: {!paletteQuery.value.trim()
					? '0.3'
					: '1'}"
			>
				{paletteLoading.value ? '...' : 'Go'}
			</button>
			<button onclick={close} class="press shrink-0" style="color: var(--ink-4)" aria-label="Close">
				<Icon name="xmark" class="h-4 w-4" />
			</button>
		</div>

		<div class="max-h-[50vh] overflow-y-auto">
			{#if paletteResponse.value}
				<div class="p-4">
					<p class="text-[16px] leading-relaxed" style="color: var(--ink)">
						{paletteResponse.value.answer}
					</p>
					{#if paletteResponse.value.detail && paletteResponse.value.detail.length > 0}
						<div class="mt-3 space-y-2">
							{#each paletteResponse.value.detail as d (d.label)}
								<div class="flex items-center justify-between text-[14px]">
									<span style="color: var(--ink-2)">{d.label}</span>
									<span class="num font-medium" style="color: var(--ink)"
										>{formatMinor(d.amountMinor, currency)}</span
									>
								</div>
							{/each}
						</div>
					{/if}
					<button
						onclick={() => {
							paletteQuery.value = '';
							paletteResponse.value = null;
							paletteInputEl.value?.focus();
						}}
						class="mt-3 text-[13px] font-medium"
						style="color: var(--ws-accent)"
					>
						Ask something else
					</button>
				</div>
			{:else}
				<div class="p-4">
					<p
						class="text-[11px] font-semibold tracking-[0.08em] uppercase"
						style="color: var(--ink-4)"
					>
						Try asking
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each EXAMPLE_PROMPTS as example (example)}
							<button
								onclick={() => pickExample(example)}
								class="press rounded-full px-3 py-1.5 text-[13px]"
								style="background: var(--surface-2); color: var(--ink-2)"
							>
								{example}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
