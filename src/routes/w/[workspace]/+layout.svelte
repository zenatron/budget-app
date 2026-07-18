<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data, children } = $props();

	// Live updates: any workspace event (already seal-filtered server-side)
	// refreshes the current page's data. Debounced to survive bursts.
	$effect(() => {
		const source = new EventSource(`/w/${data.workspace.slug}/events`);
		let timer: ReturnType<typeof setTimeout> | undefined;
		source.onmessage = (e) => {
			if (e.data.includes('"hello"')) return;
			clearTimeout(timer);
			timer = setTimeout(() => invalidateAll(), 150);
		};
		return () => {
			clearTimeout(timer);
			source.close();
		};
	});

	// Push subscriptions rotate and expire; re-upsert ours on every launch so
	// the server always has the live endpoint (and last_seen_at stays fresh).
	$effect(() => {
		if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
		if (Notification.permission !== 'granted') return;
		navigator.serviceWorker.ready.then(async (reg) => {
			const sub = await reg.pushManager.getSubscription();
			if (!sub) return;
			fetch('/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(sub.toJSON())
			}).catch(() => {});
		});
	});

	function switchWorkspace(event: Event) {
		const slug = (event.currentTarget as HTMLSelectElement).value;
		if (slug === '__new') goto('/welcome');
		else if (slug !== data.workspace.slug) goto(`/w/${slug}`);
	}
</script>

<svelte:head>
	<title>{data.workspace.name} — Budget</title>
</svelte:head>

<div class="min-h-svh bg-neutral-50 dark:bg-neutral-950">
	<header
		class="sticky top-0 z-10 border-b border-neutral-200/60 bg-neutral-50/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80"
	>
		<div class="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
			<select
				value={data.workspace.slug}
				onchange={switchWorkspace}
				aria-label="Switch workspace"
				class="rounded-lg border-none bg-transparent pr-8 text-sm font-semibold text-neutral-900 focus:ring-2 dark:text-neutral-50"
			>
				{#each data.workspaces as ws (ws.slug)}
					<option value={ws.slug}>{ws.name}</option>
				{/each}
				<option value="__new">New workspace…</option>
			</select>
			<div class="flex items-center gap-3">
				<a
					href="/w/{data.workspace.slug}/settings/notifications"
					aria-label="Notification settings"
					class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
				>
					🔔
				</a>
				<span class="text-sm text-neutral-500 dark:text-neutral-400">{data.user.displayName}</span>
				<form method="POST" action="/auth/logout">
					<button
						class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
					>
						Sign out
					</button>
				</form>
			</div>
		</div>
	</header>
	<main class="mx-auto max-w-3xl px-4 py-6">
		{@render children()}
	</main>
</div>
