<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { formatMinor } from '$lib/money-format';
	import { EXAMPLE_PROMPTS } from '$lib/intelligence/parser';
	import Icon from '$lib/components/Icon.svelte';

	let { currency = 'USD' }: { currency?: string } = $props();

	let open = $state(false);
	let query = $state('');
	let loading = $state(false);
	let response: {
		intent: string;
		answer: string;
		detail?: { label: string; amountMinor: bigint }[];
		target?: string;
	} | null = $state(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	const slug = $derived(page.params.workspace);

	function toggle() {
		open = !open;
		query = '';
		response = null;
		if (open) {
			requestAnimationFrame(() => inputEl?.focus());
		}
	}

	function pickExample(prompt: string) {
		query = prompt;
		submit();
	}

	async function submit() {
		const q = query.trim();
		if (!q || loading) return;
		loading = true;
		response = null;
		try {
			const res = await fetch(`/w/${slug}/intelligence`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: q })
			});
			const data = await res.json();
			response = data;
			if (data.target) {
				setTimeout(() => {
					open = false;
					goto(`/w/${slug}/${data.target}`);
				}, 600);
			}
		} catch {
			response = { intent: 'error', answer: 'Something went wrong. Try again.' };
		}
		loading = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (response) {
				query = '';
				response = null;
				inputEl?.focus();
			} else {
				open = false;
			}
		}
	}
</script>

<button
	onclick={toggle}
	class="press flex h-8 w-8 items-center justify-center rounded-full"
	style="background: color-mix(in oklab, var(--ws-accent) 12%, transparent); color: var(--ws-accent)"
	aria-label="Ask Budget"
>
	<Icon name="sparkle" class="h-[17px] w-[17px]" />
</button>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50"
		style="background: oklch(0 0 0 / 0.18)"
		onclick={() => (open = false)}
		onkeydown={() => {}}
	></div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-x-4 top-[20vh] z-50 mx-auto max-w-lg"
		onkeydown={handleKeydown}
	>
		<div
			class="card-lg overflow-hidden"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
		>
				<div
					class="flex items-center gap-3 border-b px-4 py-3"
					style="border-color: var(--hairline)"
				>
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
						style="background: color-mix(in oklab, var(--ws-accent) 16%, transparent)"
					>
						<Icon name="sparkle" class="h-4 w-4" style="color: var(--ws-accent)" />
					</span>
					<input
						bind:this={inputEl}
						bind:value={query}
						onkeydown={(e) => {
							if (e.key === 'Enter') submit();
						}}
						placeholder="Ask anything..."
						class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
						style="color: var(--ink)"
					/>
					<button
						onclick={submit}
						disabled={loading || !query.trim()}
						class="press shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold"
						style="background: var(--ink); color: var(--paper); opacity: {!query.trim()
							? '0.3'
							: '1'}"
					>
						{loading ? '...' : 'Go'}
					</button>
					<button
						onclick={() => (open = false)}
						class="press shrink-0"
						style="color: var(--ink-4)"
						aria-label="Close"
					>
						<Icon name="xmark" class="h-4 w-4" />
					</button>
				</div>

				<div class="max-h-[50vh] overflow-y-auto">
					{#if response}
						<div class="p-4">
							<p class="text-[16px] leading-relaxed" style="color: var(--ink)">{response.answer}</p>
							{#if response.detail && response.detail.length > 0}
								<div class="mt-3 space-y-2">
									{#each response.detail as d}
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
									query = '';
									response = null;
									inputEl?.focus();
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
								{#each EXAMPLE_PROMPTS as example}
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
{/if}
