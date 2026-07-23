<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dismiss, toasts } from '$lib/toast-state.svelte';
	import { Check, CircleAlert } from '@lucide/svelte';
</script>

<!--
	Above the tab bar, not over it: the nav is the primary way out of any screen
	and a toast covering it would trap a thumb mid-task.
-->
<div
	class="pointer-events-none fixed right-0 bottom-0 left-0 z-50 flex flex-col items-center gap-2 px-4"
	style="padding-bottom: calc(6.25rem + env(safe-area-inset-bottom, 0px))"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toasts.value as toast (toast.id)}
		<div
			class="material card-lg pointer-events-auto flex w-full max-w-sm items-center gap-2.5 px-4 py-3"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
			transition:fly={{ y: 12, duration: 180 }}
		>
			{#if toast.kind === 'success'}
				<Check class="h-4 w-4 shrink-0" style="color: var(--approve)" />
			{:else}
				<CircleAlert class="h-4 w-4 shrink-0" style="color: var(--deny)" />
			{/if}
			<span class="flex-1 text-[15px]" style="color: var(--ink)">{toast.message}</span>
			<button
				onclick={() => dismiss(toast.id)}
				class="press shrink-0 text-[13px]"
				style="color: var(--ink-3)"
				aria-label="Dismiss">Close</button
			>
		</div>
	{/each}
</div>
