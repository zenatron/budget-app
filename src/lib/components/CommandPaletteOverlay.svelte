<script lang="ts">
	import { fly } from 'svelte/transition';
	import { formatMinor } from '$lib/money-format';
	import { EXAMPLE_PROMPTS, understand } from '$lib/intelligence/parser';
	import { Sparkles, X } from '@lucide/svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import {
		paletteQuery,
		paletteLoading,
		paletteResponse,
		paletteInputEl,
		close,
		submit,
		pickExample,
		fillExample,
		handleKeydown,
		executeProposal,
		type Proposal
	} from '$lib/command-palette-state.svelte';

	let { currency = 'USD', assistEnabled = false }: { currency?: string; assistEnabled?: boolean } =
		$props();

	// The parser is pure and synchronous, so this runs on every keystroke with no
	// network and no debounce — that's the whole point of showing it live.
	const reading = $derived(understand(paletteQuery.value));

	// When a model is configured, Harmony can answer free text the parser doesn't
	// recognize — so any non-trivial query is submittable, not just grammar the
	// deterministic parser owns. Without a model we keep the old gate: unrecognized
	// input stays a dead end and we show suggestions instead.
	// Only 'unknown' input is handed to the model. 'incomplete' (a command missing
	// its amount, say) keeps the deterministic completion hints — those guide the
	// user better than a round-trip would.
	const canAsk = $derived(
		assistEnabled && reading.intent === 'unknown' && paletteQuery.value.trim().length >= 3
	);
	const ready = $derived(reading.ready || canAsk);

	// Completing a half-typed command, versus offering cold-start examples.
	const completing = $derived(reading.suggestions.length > 0 && paletteQuery.value.length > 0);
	const prompts = $derived(completing ? reading.suggestions : EXAMPLE_PROMPTS);

	function proposalSummary(p: Proposal): string {
		if (p.intent === 'create_bucket') {
			return `Create bucket “${p.name}” — ${formatMinor(BigInt(p.amountMinor), currency)}/mo on day ${p.dayOfMonth}`;
		}
		if (p.intent === 'create_income') {
			return `Add income “${p.source}” — ${formatMinor(BigInt(p.amountMinor), currency)}${p.monthly ? ` monthly on day ${p.dayOfMonth}` : ' once'}`;
		}
		return `Open ${p.label}`;
	}

	function proposalButton(p: Proposal): string {
		if (p.intent === 'create_bucket') return 'Create bucket';
		if (p.intent === 'create_income') return 'Add income';
		return 'Open';
	}
</script>

<div class="fixed inset-0 z-50" style="background: var(--scrim)" use:dismiss={close}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-x-4 top-[16vh] z-50 mx-auto max-w-lg" onkeydown={handleKeydown}>
	<div
		class="card-lg overflow-hidden"
		style="box-shadow: var(--shadow-float); background: var(--surface)"
	>
		<!--
			The input is the hero of this panel, so it gets the full row: no border
			box of its own, generous height, and the sparkle doubles as the focus
			indicator by tinting with the workspace accent.
		-->
		<div class="relative">
			<div class="flex items-center gap-3 px-4 pt-4 pb-3.5">
				<span
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors"
					style="background: color-mix(in oklab, var(--ws-accent) {paletteQuery.value
						? '22'
						: '14'}%, transparent)"
				>
					<Sparkles class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
				</span>
				<input
					bind:this={paletteInputEl.value}
					bind:value={paletteQuery.value}
					onkeydown={(e) => {
						if (e.key === 'Enter' && ready) submit();
					}}
					placeholder="Ask Harmony…"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					aria-label="Ask Harmony"
					class="min-w-0 flex-1 border-none bg-transparent p-0 text-[17px] leading-tight outline-none placeholder:opacity-35 focus:ring-0"
					style="color: var(--ink); box-shadow: none"
				/>
				{#if paletteQuery.value}
					<button
						onclick={submit}
						disabled={paletteLoading.value || !ready}
						class="press shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-opacity"
						style="background: var(--ws-accent); color: white; opacity: {ready &&
						!paletteLoading.value
							? '1'
							: '0.35'}"
					>
						{paletteLoading.value ? '…' : 'Go'}
					</button>
				{/if}
				<button
					onclick={close}
					class="press shrink-0"
					style="color: var(--ink-3)"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Live reading of the query: what we think it means, before you commit. -->
			{#if !paletteResponse.value && reading.label}
				<div
					class="flex flex-wrap items-center gap-1.5 px-4 pb-3.5"
					transition:fly={{ y: -4, duration: 140 }}
				>
					<span
						class="rounded-full px-2 py-[3px] text-[11px] font-semibold tracking-[0.04em] uppercase"
						style="background: color-mix(in oklab, var(--ws-accent) 16%, transparent); color: color-mix(in oklab, var(--ws-accent) 75%, black)"
						>{reading.label}</span
					>
					{#each reading.slots as slot (slot.label)}
						<span
							class="rounded-full px-2 py-[3px] text-[11px]"
							style="background: var(--surface-2); color: var(--ink-2)"
						>
							<span style="color: var(--ink-3)">{slot.label}</span>
							{slot.value}
						</span>
					{/each}
					{#each reading.missing as m (m)}
						<span
							class="rounded-full px-2 py-[3px] text-[11px]"
							style="background: color-mix(in oklab, var(--pending) 14%, transparent); color: color-mix(in oklab, var(--pending) 80%, black)"
							>needs {m}</span
						>
					{/each}
				</div>
			{/if}

			<div class="h-px" style="background: var(--hairline)"></div>
		</div>

		<div class="max-h-[50vh] overflow-y-auto">
			{#if paletteResponse.value}
				<div class="p-4">
					{#if paletteResponse.value.propose}
						<p
							class="text-[13px] font-medium tracking-[0.06em] uppercase"
							style="color: var(--ink-3)"
						>
							Ready to confirm
						</p>
						<p class="mt-1 text-[16px] leading-relaxed" style="color: var(--ink)">
							{proposalSummary(paletteResponse.value.propose)}
						</p>
						<p class="mt-1 text-[13px] leading-relaxed" style="color: var(--ink-3)">
							{paletteResponse.value.answer}
						</p>
						<div class="mt-3 flex items-center gap-2">
							<button
								onclick={() =>
									paletteResponse.value?.propose && executeProposal(paletteResponse.value.propose)}
								disabled={paletteLoading.value}
								class="btn btn-accent px-4 py-2 text-[14px]"
							>
								{paletteLoading.value ? '…' : proposalButton(paletteResponse.value.propose)}
							</button>
							<button
								onclick={() => {
									paletteQuery.value = '';
									paletteResponse.value = null;
									paletteInputEl.value?.focus();
								}}
								class="btn btn-ghost px-4 py-2 text-[14px]"
							>
								Cancel
							</button>
						</div>
					{:else}
						<p class="text-[16px] leading-relaxed" style="color: var(--ink)">
							{paletteResponse.value.answer}
						</p>
						{#if paletteResponse.value.detail && paletteResponse.value.detail.length > 0}
							<div class="mt-3 space-y-2">
								{#each paletteResponse.value.detail as d (d.label)}
									<div class="flex items-center justify-between text-[14px]">
										<span style="color: var(--ink-2)">{d.label}</span>
										<span class="num font-medium" style="color: var(--ink)"
											>{formatMinor(BigInt(d.amountMinor), currency)}</span
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
					{/if}
				</div>
			{:else if !ready}
				<div class="p-4">
					<p
						class="text-[11px] font-semibold tracking-[0.08em] uppercase"
						style="color: var(--ink-3)"
					>
						{completing ? 'Did you mean' : 'Try asking'}
					</p>
					<div class="mt-2 flex flex-col items-start gap-1.5">
						{#each prompts as example (example)}
							<button
								onclick={() => (completing ? fillExample(example) : pickExample(example))}
								class="press max-w-full rounded-full px-3 py-1.5 text-left text-[13px]"
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
