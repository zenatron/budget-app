<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { submit } from '$lib/actions/submit';
	import { money } from '$lib/actions/money';
	import { dismiss } from '$lib/actions/dismiss';
	import { X } from '@lucide/svelte';

	// `open` is bindable so the FAB long-press can drive it; the form's action
	// posts to the real new-purchase route, so no layout-level action is needed.
	let { open = $bindable(false), slug }: { open?: boolean; slug: string } = $props();

	let itemName = $state('');
	let amount = $state('');

	function reset() {
		open = false;
		itemName = '';
		amount = '';
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50"
		style="background: var(--scrim)"
		use:dismiss={reset}
		transition:fade={{ duration: 140 }}
	></div>
	<div
		class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
		role="dialog"
		aria-modal="true"
		aria-label="Quick log a purchase"
		transition:fly={{ y: 24, duration: 200 }}
	>
		<div
			class="card-lg overflow-hidden"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
		>
			<div class="flex items-center justify-between px-5 pt-4 pb-1">
				<h2 class="font-[family-name:var(--font-display)] text-[20px]" style="color: var(--ink)">
					Quick log
				</h2>
				<button
					onclick={reset}
					class="press -mr-1 flex h-8 w-8 items-center justify-center rounded-full"
					style="color: var(--ink-4)"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
			<p class="px-5 pb-3 text-[13px]" style="color: var(--ink-4)">
				Record something you already bought.
			</p>

			<form
				method="POST"
				action="/w/{slug}/purchases/new"
				use:submit={{ onSuccess: reset }}
				class="space-y-3 px-5 pb-5"
			>
				<input type="hidden" name="intent" value="log" />
				<div class="grid grid-cols-[1fr_auto] gap-3">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="itemName"
						bind:value={itemName}
						required
						autofocus
						placeholder="What did you buy?"
						class="field text-[16px]"
					/>
					<input
						name="amount"
						bind:value={amount}
						required
						use:money
						inputmode="decimal"
						placeholder="0.00"
						class="field w-28 text-[16px] tabular-nums"
					/>
				</div>
				<button class="btn btn-accent w-full py-3 text-[15px]">Log it</button>
				<a
					href="/w/{slug}/purchases/new"
					onclick={reset}
					class="press block text-center text-[13px]"
					style="color: var(--ink-4)"
				>
					More options
				</a>
			</form>
		</div>
	</div>
{/if}
