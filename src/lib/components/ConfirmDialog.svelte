<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { dismiss } from '$lib/actions/dismiss';
	import { confirmState, answerConfirm } from '$lib/confirm-state.svelte';

	const spec = $derived(confirmState.current);
</script>

{#if spec}
	<div
		class="fixed inset-0 z-[60]"
		style="background: oklch(0 0 0 / 0.32)"
		use:dismiss={() => answerConfirm(false)}
		transition:fade={{ duration: 120 }}
	></div>
	<div
		class="fixed inset-x-4 top-1/2 z-[60] mx-auto max-w-sm -translate-y-1/2"
		role="alertdialog"
		aria-modal="true"
		aria-label={spec.title}
		transition:scale={{ start: 0.95, duration: 160 }}
	>
		<div
			class="card-lg overflow-hidden p-5"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
		>
			<h2 class="text-[18px] font-semibold" style="color: var(--ink)">{spec.title}</h2>
			{#if spec.body}
				<p
					class="mt-2 text-[15px] leading-relaxed"
					style="color: var(--ink-3); white-space: pre-line"
				>
					{spec.body}
				</p>
			{/if}
			<div class="mt-5 flex gap-2.5">
				<button
					onclick={() => answerConfirm(false)}
					class="btn btn-ghost flex-1 py-2.5 text-[15px]"
				>
					{spec.cancelLabel ?? 'Cancel'}
				</button>
				<button
					onclick={() => answerConfirm(true)}
					class="btn flex-1 py-2.5 text-[15px]"
					style={spec.tone === 'danger'
						? 'background: var(--deny); color: var(--paper)'
						: 'background: var(--ink); color: var(--paper)'}
				>
					{spec.confirmLabel ?? 'Confirm'}
				</button>
			</div>
		</div>
	</div>
{/if}
