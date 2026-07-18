<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
</script>

<svelte:head><title>Welcome — Budget</title></svelte:head>

<main
	class="min-h-svh px-5 py-10"
	style="--ws-accent: #B4472B; --accent: #B4472B; padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 2.5rem)"
>
	<div class="mx-auto max-w-md space-y-4">
		<header class="px-1 pt-4 pb-2">
			<h1 class="text-[30px] leading-tight">Hi, {data.displayName}</h1>
			<p class="mt-1 text-[17px] leading-relaxed" style="color: var(--ink-3)">
				Create a workspace or join one with an invite code.
			</p>
		</header>

		{#if data.workspaces.length > 0}
			<div class="card overflow-hidden">
				{#each data.workspaces as ws, i (ws.slug)}
					<a
						href="/w/{ws.slug}"
						class="row row-tap {i < data.workspaces.length - 1 ? 'hairline' : ''}"
					>
						<span
							class="flex h-8 w-8 items-center justify-center rounded-[9px] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white"
							style="background: color-mix(in oklab, var(--ws-accent) 80%, black)"
							>{ws.name.charAt(0)}</span
						>
						<span class="flex-1 text-[17px]" style="color: var(--ink)">{ws.name}</span>
						<Icon name="chevronRight" class="h-4 w-4" style="color: var(--ink-4)" />
					</a>
				{/each}
			</div>
		{/if}

		<div class="card space-y-3.5 p-5">
			<p class="text-[17px] font-semibold" style="color: var(--ink)">Create a workspace</p>
			<form method="POST" action="?/create" use:enhance class="space-y-3.5">
				<input name="name" required maxlength="60" placeholder="Our household" class="field" />
				<div class="grid grid-cols-2 gap-3">
					<select name="currency" class="field text-[15px]">
						{#each data.currencies as c (c)}<option value={c} selected={c === 'USD'}>{c}</option
							>{/each}
					</select>
					<select name="timezone" class="field text-[15px]">
						{#each data.timezones as t (t)}<option value={t} selected={t === tz}>{t}</option>{/each}
					</select>
				</div>
				{#if form?.action === 'create' && form?.error}
					<div
						class="rounded-[10px] px-4 py-3 text-[15px]"
						style="color: var(--deny); background: color-mix(in oklab, var(--deny) 14%, transparent)"
					>
						{form.error}
					</div>
				{/if}
				<button class="btn btn-accent w-full">Create workspace</button>
			</form>
		</div>

		<div class="card space-y-3.5 p-5">
			<p class="text-[17px] font-semibold" style="color: var(--ink)">Join a workspace</p>
			<form method="POST" action="?/join" use:enhance class="space-y-3.5">
				<input
					name="code"
					required
					placeholder="e.g. 7XK2M9QRTB"
					autocapitalize="characters"
					autocomplete="off"
					spellcheck="false"
					class="field text-center font-mono tracking-[0.14em] uppercase"
				/>
				{#if form?.action === 'join' && form?.error}
					<div
						class="rounded-[10px] px-4 py-3 text-[15px]"
						style="color: var(--deny); background: color-mix(in oklab, var(--deny) 14%, transparent)"
					>
						{form.error}
					</div>
				{/if}
				<button class="btn btn-ghost w-full">Join with code</button>
			</form>
		</div>

		<form method="POST" action="/auth/logout" class="pt-1 text-center">
			<button class="btn btn-plain" style="color: var(--ink-4)">Sign out</button>
		</form>
	</div>
</main>
