<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const accents = [
		'#FF9F0A', '#FF375F', '#30D158', '#0A84FF',
		'#BF5AF2', '#FF453A', '#40C8E0', '#FFD60A', '#B4472B'
	];

	let selectedColor = $state(accents[0]);
	let showPicker = $state(false);

	function togglePicker() {
		showPicker = !showPicker;
	}

	function selectColor(color: string) {
		selectedColor = color;
		showPicker = false;
	}

	function accentFor(ws: { slug: string; accentColor?: string | null }): string {
		if (ws.accentColor) return ws.accentColor;
		return accents[
			ws.slug.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % accents.length
		];
	}
</script>

<svelte:head><title>Welcome — Budget</title></svelte:head>

<main
	class="min-h-svh px-5 py-10"
	style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 2.5rem)"
>
	<div class="mx-auto max-w-md space-y-6">
		<header class="px-1 pt-4 pb-2">
			<h1 class="text-[28px] leading-tight">Hi, {data.displayName}</h1>
			<p class="mt-1.5 text-[16px] leading-relaxed" style="color: var(--ink-3)">
				Pick a workspace to continue, or create a new one.
			</p>
		</header>

		{#if data.workspaces.length > 0}
			<div class="space-y-2">
				{#each data.workspaces as ws (ws.slug)}
					{@const color = accentFor(ws)}
					<a
						href="/w/{ws.slug}"
						class="card press flex items-center gap-3.5 overflow-hidden px-4 py-3.5"
						style="box-shadow: var(--shadow-card), inset 0 0 0 0.5px var(--hairline)"
					>
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[16px] font-semibold text-white"
							style="background: color-mix(in oklab, {color} 80%, black)"
						>
							{ws.name.charAt(0)}
						</span>
						<span class="flex-1 truncate text-[17px] font-medium" style="color: var(--ink)">
							{ws.name}
						</span>
						<Icon name="chevronRight" class="h-4 w-4 shrink-0" style="color: var(--ink-4)" />
					</a>
				{/each}
			</div>
		{/if}

		<div class="card space-y-4 p-5">
			<form method="POST" action="?/create" use:enhance class="space-y-4">
				<div class="flex items-start gap-3">
					<div class="relative">
						<button
							type="button"
							onclick={togglePicker}
							class="press flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white transition-transform"
							style="background: {selectedColor}"
							aria-label="Choose accent color"
						>
							<Icon name="plus" class="h-4 w-4" />
						</button>
						{#if showPicker}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="fixed inset-0 z-40"
								onclick={() => (showPicker = false)}
								onkeydown={() => {}}
							></div>
							<div
								class="card absolute top-full left-0 z-50 mt-2 grid grid-cols-5 gap-2 p-2.5"
								style="box-shadow: var(--shadow-float)"
							>
								{#each accents as c}
									<button
										type="button"
										onclick={() => selectColor(c)}
										class="press h-8 w-8 rounded-full"
										style="background: {c}; outline: {c === selectedColor
											? '2px solid var(--ink)'
											: 'none'}; outline-offset: 2px"
										aria-label="Select color"
									></button>
								{/each}
							</div>
						{/if}
					</div>
					<div class="flex-1 space-y-1">
						<p class="text-[17px] font-semibold" style="color: var(--ink)">Create a workspace</p>
						<input name="name" required maxlength="60" placeholder="Our household" class="field text-[15px]" />
					</div>
				</div>
				<input type="hidden" name="accentColor" value={selectedColor} />
				<div class="grid grid-cols-2 gap-3">
					<select name="currency" class="field text-[15px]">
						{#each data.currencies as c}<option value={c} selected={c === 'USD'}>{c}</option>{/each}
					</select>
					<select name="timezone" class="field text-[15px]">
						{#each data.timezones as t}<option value={t} selected={t === tz}>{t}</option>{/each}
					</select>
				</div>
				{#if form?.action === 'create' && form?.error}
					<div
						class="rounded-[10px] px-4 py-3 text-[14px] font-medium"
						style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, transparent)"
					>
						{form.error}
					</div>
				{/if}
				<button class="btn btn-accent w-full">Create workspace</button>
			</form>
		</div>

		<div class="card space-y-3.5 p-5">
			<p class="text-[13px] font-semibold tracking-[0.06em] uppercase" style="color: var(--ink-4)">
				Join with invite code
			</p>
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
						class="rounded-[10px] px-4 py-3 text-[14px] font-medium"
						style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, transparent)"
					>
						{form.error}
					</div>
				{/if}
				<button class="btn btn-ghost w-full">Join</button>
			</form>
		</div>

		<form method="POST" action="/auth/logout" class="pt-1 text-center">
			<button class="btn btn-plain text-[15px]" style="color: var(--ink-4)">Sign out</button>
		</form>
	</div>
</main>
