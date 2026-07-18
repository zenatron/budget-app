<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	let status = $derived(page.status);
	const m: Record<number, { icon: string; t: string; d: string }> = {
		404: { icon: 'search', t: 'Not found', d: "This page doesn't exist." },
		403: { icon: 'lock', t: 'Access denied', d: "You don't have permission to see this." },
		500: { icon: 'exclamation', t: 'Something went wrong', d: 'An unexpected error occurred.' }
	};
	let x = $derived(m[status] ?? m[500]);
</script>

<svelte:head><title>{x.t} — Budget</title></svelte:head>

<div
	class="flex min-h-svh items-center justify-center px-6"
	style="--ws-accent: #B4472B; --accent: #B4472B"
>
	<div class="text-center">
		<div
			class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
			style="background: var(--surface)"
		>
			<Icon name={x.icon} class="h-6 w-6" style="color: var(--ink-3)" />
		</div>
		<h1 class="text-[22px]">{x.t}</h1>
		<p class="mt-1 text-[15px]" style="color: var(--ink-3)">{x.d}</p>
		<a href="/" class="btn btn-accent mt-6">Go home</a>
	</div>
</div>
