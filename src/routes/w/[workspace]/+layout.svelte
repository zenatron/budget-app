<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import CommandPaletteOverlay from '$lib/components/CommandPaletteOverlay.svelte';
	import { paletteOpen } from '$lib/command-palette-state.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { toastError } from '$lib/toast-state.svelte';
	import { accentFor } from '$lib/accent';

	let { data, children } = $props();
	let pathname = $derived(page.url.pathname);

	// Derive slug from the URL, not from data — data can be stale during
	// client-side navigation when SvelteKit reuses a layout component.
	let slug = $derived(page.params.workspace ?? '');

	// Derive workspace display name from the workspaces list using the URL slug,
	// because data.workspace.name from $props() can be stale during client-side nav.
	let wsName = $derived(
		data.workspaces.find((w: { slug: string }) => w.slug === slug)?.name ?? data.workspace.name
	);

	function isActive(section: string): boolean {
		const base = `/w/${slug}`;
		if (section === '') return pathname === base || pathname === `${base}/`;
		return pathname.startsWith(`${base}/${section}`);
	}

	$effect(() => {
		const source = new EventSource(`/w/${slug}/events`);
		let t: ReturnType<typeof setTimeout> | undefined;
		source.onmessage = (e) => {
			if (e.data.includes('"hello"')) return;
			clearTimeout(t);
			t = setTimeout(() => invalidateAll(), 200);
		};
		return () => {
			clearTimeout(t);
			source.close();
		};
	});

	$effect(() => {
		if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
		if (Notification.permission !== 'granted') return;
		void navigator.serviceWorker.ready.then(async (reg) => {
			const sub = await reg.pushManager.getSubscription();
			if (!sub) return;
			try {
				const res = await fetch('/push', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(sub.toJSON())
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				// Silence here means notifications quietly stop arriving and the
				// settings page still claims they're on.
				toastError('Push notifications could not be re-registered');
			}
		});
	});

	let showSwitcher = $state(false);
	// Measured, not guessed: the header's height varies with the safe-area inset,
	// and anything docking beneath it needs the real number.
	let headerH = $state(0);

	// Resolved from the workspaces list by URL slug, for the same reason as
	// wsName above: data.workspace lags during client-side navigation, so
	// reading it directly painted the new workspace in the old one's accent.
	const accent = $derived(
		accentFor(data.workspaces.find((w: { slug: string }) => w.slug === slug) ?? data.workspace)
	);

	const tabs = [
		{ section: 'purchases', label: 'Wallet', icon: 'card' },
		{ section: 'analytics', label: 'Activity', icon: 'chart' },
		{ section: 'buckets', label: 'Buckets', icon: 'bank' },
		{ section: 'recurring', label: 'Recurring', icon: 'repeat' },
		{ section: 'income', label: 'Income', icon: 'dollar' }
	];

	function isSettings(): boolean {
		return (
			isActive('') &&
			!isActive('purchases') &&
			!isActive('analytics') &&
			!isActive('buckets') &&
			!isActive('recurring') &&
			!isActive('income')
		);
	}
</script>

<svelte:head><title>{wsName} — Ledger</title></svelte:head>

{#key slug}
	<div
		class="min-h-viewport flex flex-col"
		style="--ws-accent: {accent}; --accent: {accent}; --header-h: {headerH}px"
	>
		<header
			bind:clientHeight={headerH}
			class="material sticky top-0 z-20"
			style="padding-top: max(env(safe-area-inset-top, 0px), 8px)"
		>
			<div class="relative mx-auto flex max-w-3xl items-center justify-between px-5 py-2.5">
				<button
					onclick={() => (showSwitcher = !showSwitcher)}
					class="press flex items-center gap-2.5"
					aria-label="Switch workspace — currently {wsName}"
					aria-expanded={showSwitcher}
					aria-haspopup="menu"
				>
					<span
						class="flex h-7 w-7 items-center justify-center rounded-[8px] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white"
						style="background: color-mix(in oklab, var(--ws-accent) 80%, black)"
						>{wsName.charAt(0)}</span
					>
					<span class="max-w-[140px] truncate text-[17px] font-semibold" style="color: var(--ink)"
						>{wsName}</span
					>
					<Icon
						name="chevronDown"
						class="h-3.5 w-3.5 shrink-0 transition-transform duration-200 {showSwitcher
							? 'rotate-180'
							: ''}"
					/>
				</button>
				<div class="flex items-center gap-2">
					<CommandPalette />
					<a
						href="/w/{slug}/purchases/new"
						class="press flex h-8 w-8 items-center justify-center rounded-full"
						style="background: var(--ink); color: var(--paper)"
						aria-label="New purchase"
					>
						<Icon name="plus" class="h-[18px] w-[18px]" />
					</a>
				</div>

				{#if showSwitcher}
					<div class="fixed inset-0 z-30" use:dismiss={() => (showSwitcher = false)}></div>
					<div
						class="material card-lg absolute top-full left-0 z-40 mt-1 w-64 overflow-hidden p-1.5"
						style="box-shadow: var(--shadow-float); background: var(--surface); backdrop-filter: saturate(1.4) blur(24px); -webkit-backdrop-filter: saturate(1.4) blur(24px)"
						role="menu"
					>
						{#each data.workspaces as ws (ws.slug)}
							{@const active = ws.slug === slug}
							{@const wsAccent = accentFor(ws)}
							<a
								href="/w/{ws.slug}"
								onclick={() => (showSwitcher = false)}
								class="press flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5"
								style={active ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
							>
								<span
									class="flex h-8 w-8 items-center justify-center rounded-[9px] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white"
									style="background: color-mix(in oklab, {wsAccent} 80%, black)"
									>{ws.name.charAt(0)}</span
								>
								<span class="text-[17px]" style="color: var(--ink)">{ws.name}</span>
								{#if active}
									<Icon name="checkmark" class="ml-auto h-4 w-4" style="color: var(--ink)" />
								{/if}
							</a>
						{/each}
						<div class="my-1 h-px" style="background: var(--hairline)"></div>
						<a
							href="/welcome"
							onclick={() => (showSwitcher = false)}
							class="press flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5"
						>
							<span
								class="flex h-8 w-8 items-center justify-center rounded-[10px]"
								style="box-shadow: inset 0 0 0 1.5px var(--hairline-strong)"
								><Icon name="plus" class="h-4 w-4" style="color: var(--ink-3)" /></span
							>
							<span class="text-[17px]" style="color: var(--ink-3)">New workspace</span>
						</a>
					</div>
				{/if}
			</div>
		</header>

		<!--
			overflow-x: clip contains anything that translates sideways — the Activity
			swipe moves its card right, which otherwise added ~74px of document width.
			On a phone that widens the layout viewport and the PWA zooms out to fit,
			so dragging back in time visibly shrank the whole app.

			Applied here rather than on <html>: overflow on the root element is
			propagated to the viewport, and there `clip` still let the page pan.
			`clip` not `hidden`, so overflow-y stays visible and the page keeps
			scrolling normally.
		-->
		<main
			class="mx-auto w-full max-w-3xl flex-1 px-4 pt-3"
			style="overflow-x: clip; padding-bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px))"
		>
			{@render children()}
		</main>

		{#if paletteOpen.value}
			<CommandPaletteOverlay currency={data.workspace.currency} />
		{/if}

		<nav
			class="material fixed right-0 bottom-0 left-0 z-20"
			style="padding-bottom: max(env(safe-area-inset-bottom, 0px), 6px); box-shadow: 0 -0.5px 0 var(--hairline)"
		>
			<div class="mx-auto flex max-w-3xl justify-around px-2 pt-1.5">
				{#each tabs as tab (tab.section)}
					{@const active = isActive(tab.section)}
					<a
						href="/w/{slug}/{tab.section}"
						class="press flex flex-col items-center gap-1 py-1 text-[10px]"
						style="color: {active ? 'var(--ink)' : 'var(--ink-4)'}"
						aria-current={active ? 'page' : undefined}
					>
						<Icon name={tab.icon} class="h-[24px] w-[24px]" />
						<span class="font-medium tracking-tight">{tab.label}</span>
					</a>
				{/each}
				<a
					href="/w/{slug}"
					class="press flex flex-col items-center gap-1 py-1 text-[10px]"
					style="color: {isSettings() ? 'var(--ink)' : 'var(--ink-4)'}"
					aria-current={isSettings() ? 'page' : undefined}
				>
					<Icon name="gear" class="h-[24px] w-[24px]" />
					<span class="font-medium tracking-tight">Settings</span>
				</a>
			</div>
		</nav>
	</div>
{/key}
