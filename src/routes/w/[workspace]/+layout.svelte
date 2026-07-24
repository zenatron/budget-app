<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Check,
		ChevronDown,
		Plus,
		Settings,
		CreditCard,
		ChartNoAxesColumnIncreasing,
		Repeat,
		CircleDollarSign
	} from '@lucide/svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import CommandPaletteOverlay from '$lib/components/CommandPaletteOverlay.svelte';
	import { paletteOpen, close as closePalette } from '$lib/command-palette-state.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { longpress } from '$lib/actions/longpress';
	import { toastError } from '$lib/toast-state.svelte';
	import { accentFor } from '$lib/accent';
	import QuickLog from '$lib/components/QuickLog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let { data, children } = $props();

	// Long-pressing the FAB opens a quick-log sheet; a plain tap still opens the
	// full new-purchase page.
	let quickLogOpen = $state(false);
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

	// The command palette is global state, not page state, so it survives a
	// workspace switch — and its last answer is about the workspace you left.
	// Close it on switch so a stale response can't linger under the new URL.
	$effect(() => {
		void slug;
		closePalette();
	});

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

	/*
	 * Hide the bottom bar while the on-screen keyboard is up.
	 *
	 * On iOS a position:fixed element is anchored to the *layout* viewport, but
	 * the keyboard only shrinks the *visual* viewport — so `bottom: 0` pins the
	 * bar to the bottom of the full-height page, behind the keyboard, and Safari
	 * shifts composited fixed elements during scroll, making it drift up and rest
	 * above the keyboard. You don't need the tab nav while typing anyway, so we
	 * detect the keyboard via visualViewport (the gap between it and the layout
	 * viewport) and translate the bar out of view until the keyboard closes.
	 */
	let keyboardOpen = $state(false);
	$effect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const onChange = () => {
			// A gap this large is a keyboard, not browser chrome (which is < ~100px).
			keyboardOpen = window.innerHeight - vv.height > 140;
		};
		vv.addEventListener('resize', onChange);
		onChange();
		return () => vv.removeEventListener('resize', onChange);
	});

	// Resolved from the workspaces list by URL slug, for the same reason as
	// wsName above: data.workspace lags during client-side navigation, so
	// reading it directly painted the new workspace in the old one's accent.
	const accent = $derived(
		accentFor(data.workspaces.find((w: { slug: string }) => w.slug === slug) ?? data.workspace)
	);

	/*
	 * Four destinations either side of the new-purchase button, which sits in the
	 * middle where a thumb actually reaches.
	 *
	 * Recurring and buckets share "Plan": both are money already claimed before
	 * anything discretionary, so they read as one idea. Settings moved to the
	 * header — it's configuration, visited rarely, and it was occupying prime
	 * thumb real estate.
	 */
	const TAB_ICONS = {
		card: CreditCard,
		chart: ChartNoAxesColumnIncreasing,
		repeat: Repeat,
		dollar: CircleDollarSign
	};
	const tabs = [
		{ section: 'purchases', label: 'Ledger', icon: 'card', also: [] as string[] },
		{ section: 'analytics', label: 'Activity', icon: 'chart', also: [] as string[] },
		{ section: 'recurring', label: 'Plan', icon: 'repeat', also: ['buckets'] },
		{ section: 'income', label: 'Income', icon: 'dollar', also: [] as string[] }
	];
	const leftTabs = $derived(tabs.slice(0, 2));
	const rightTabs = $derived(tabs.slice(2));

	function tabActive(tab: { section: string; also: string[] }): boolean {
		return isActive(tab.section) || tab.also.some((s) => isActive(s));
	}

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
		style="--ws-accent-base: {accent}; --ws-accent: light-dark(var(--ws-accent-base), color-mix(in oklch, var(--ws-accent-base), white 18%)); --accent: var(--ws-accent); --header-h: {headerH}px"
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
					<ChevronDown
						class="h-3.5 w-3.5 shrink-0 transition-transform duration-200 {showSwitcher
							? 'rotate-180'
							: ''}"
					/>
				</button>
				<div class="flex items-center gap-2">
					<CommandPalette />
					<a
						href="/w/{slug}"
						class="press flex h-8 w-8 items-center justify-center rounded-full"
						style="color: {isSettings() ? 'var(--ink)' : 'var(--ink-3)'}; background: {isSettings()
							? 'var(--surface-2)'
							: 'transparent'}"
						aria-label="Settings"
						aria-current={isSettings() ? 'page' : undefined}
					>
						<Settings class="h-[20px] w-[20px]" />
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
								style={active ? 'background: color-mix(in oklab, var(--ink) 6%, transparent)' : ''}
							>
								<span
									class="flex h-8 w-8 items-center justify-center rounded-[9px] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white"
									style="background: color-mix(in oklab, {wsAccent} 80%, black)"
									>{ws.name.charAt(0)}</span
								>
								<span class="text-[17px]" style="color: var(--ink)">{ws.name}</span>
								{#if active}
									<Check class="ml-auto h-4 w-4" style="color: var(--ink)" />
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
								><Plus class="h-4 w-4" style="color: var(--ink-3)" /></span
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

		<!-- Bottom tab bar. Compositing + keyboard-hide behavior is in <style> below. -->
		<nav
			class="material fixed right-0 bottom-0 left-0 z-20"
			class:kb-hidden={keyboardOpen}
			aria-hidden={keyboardOpen}
			style="padding-bottom: max(env(safe-area-inset-bottom, 0px), 6px); box-shadow: 0 -0.5px 0 var(--hairline)"
		>
			<div class="mx-auto flex max-w-3xl items-start justify-around px-2 pt-1.5">
				{#each leftTabs as tab (tab.section)}
					{@const active = tabActive(tab)}
					{@const TabIcon = TAB_ICONS[tab.icon as keyof typeof TAB_ICONS]}
					<a
						href="/w/{slug}/{tab.section}"
						class="press flex flex-1 flex-col items-center gap-1 py-1 text-[10px]"
						style="color: {active ? 'var(--ink)' : 'var(--ink-4)'}"
						aria-current={active ? 'page' : undefined}
					>
						<TabIcon class="h-[24px] w-[24px]" />
						<span class="font-medium tracking-tight">{tab.label}</span>
					</a>
				{/each}

				<!--
					An action, not a destination — so it looks like one: raised out of
					the bar, filled with the workspace accent, no label competing with
					the tab words either side.
				-->
				<a
					href="/w/{slug}/purchases/new"
					use:longpress={() => (quickLogOpen = true)}
					class="press flex flex-1 flex-col items-center"
					aria-label="New purchase (hold to quick-log)"
				>
					<span
						class="flex h-[52px] w-[52px] -translate-y-3 items-center justify-center rounded-full text-white"
						style="background: var(--ws-accent); box-shadow: 0 6px 16px -4px color-mix(in oklab, var(--ws-accent) 55%, transparent), 0 1px 2px light-dark(oklch(0.28 0.03 65 / 0.18), oklch(0 0 0 / 0.55)); outline: 3px solid var(--paper)"
					>
						<Plus class="h-6 w-6" />
					</span>
				</a>

				{#each rightTabs as tab (tab.section)}
					{@const active = tabActive(tab)}
					{@const TabIcon = TAB_ICONS[tab.icon as keyof typeof TAB_ICONS]}
					<a
						href="/w/{slug}/{tab.section}"
						class="press flex flex-1 flex-col items-center gap-1 py-1 text-[10px]"
						style="color: {active ? 'var(--ink)' : 'var(--ink-4)'}"
						aria-current={active ? 'page' : undefined}
					>
						<TabIcon class="h-[24px] w-[24px]" />
						<span class="font-medium tracking-tight">{tab.label}</span>
					</a>
				{/each}
			</div>
		</nav>
	</div>

	<QuickLog bind:open={quickLogOpen} {slug} />
{/key}

<ConfirmDialog />

<style>
	/*
		translateZ(0) is load-bearing, not decoration: the bar is position:fixed and
		carries a backdrop-filter (.material), a pairing iOS Safari detaches during
		momentum scroll. Its own compositing layer keeps it pinned.
	*/
	nav {
		transform: translateZ(0);
		transition:
			transform 0.2s ease,
			opacity 0.2s ease,
			visibility 0.2s;
	}
	/*
		Keyboard up: slide the bar down AND stop rendering it (opacity + visibility).
		The translate alone isn't enough — the middle "+" is a raised FAB that
		overflows the top of the nav's box, so sliding down by the nav's own height
		leaves that overhang on screen, peeking above the keyboard. opacity +
		visibility removes it regardless of the FAB's geometry; visibility is
		transitioned so it flips to hidden only after the fade completes.
	*/
	nav.kb-hidden {
		transform: translateY(100%);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
</style>
