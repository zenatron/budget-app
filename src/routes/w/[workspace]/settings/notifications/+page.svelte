<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// --- Web Push client state ---
	let permission: NotificationPermission | 'unsupported' = $state('unsupported');
	let subscribed = $state(false);
	let busy = $state(false);
	let pushError: string | null = $state(null);
	let showA2hs = $state(false);

	$effect(() => {
		const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
		const standalone =
			('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
			matchMedia('(display-mode: standalone)').matches;
		// On iOS, push only exists for home-screen installs. Without this hint
		// the feature silently does nothing and looks broken.
		showA2hs = isIos && !standalone;

		if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
			permission = Notification.permission;
			navigator.serviceWorker.ready.then(async (reg) => {
				subscribed = (await reg.pushManager.getSubscription()) !== null;
			});
		}
	});

	// Must be called from a user gesture (iOS requirement).
	async function enablePush() {
		if (!data.vapidPublicKey) return;
		busy = true;
		pushError = null;
		try {
			const result = await Notification.requestPermission();
			permission = result;
			if (result !== 'granted') return;
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: data.vapidPublicKey
			});
			const res = await fetch('/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(sub.toJSON())
			});
			if (!res.ok) throw new Error(`server said ${res.status}`);
			subscribed = true;
		} catch (e) {
			pushError = e instanceof Error ? e.message : 'Could not enable push';
		} finally {
			busy = false;
		}
	}

	async function disablePush() {
		busy = true;
		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await fetch('/push', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: sub.endpoint })
				});
				await sub.unsubscribe();
			}
			subscribed = false;
		} finally {
			busy = false;
		}
	}

	const isEnabled = (event: string, channel: string) =>
		!data.disabled.includes(`${event}:${channel}`);
</script>

<div class="mx-auto max-w-md space-y-6">
	<a
		href="/w/{data.workspace.slug}"
		class="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
	>
		← {data.workspace.name}
	</a>
	<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Notifications</h1>

	{#if showA2hs}
		<section
			class="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-900/20"
		>
			<h2 class="font-medium text-amber-900 dark:text-amber-200">Install the app first</h2>
			<p class="mt-1 text-sm text-amber-800 dark:text-amber-300">
				On iPhone, notifications only work for installed apps. In Safari, tap
				<strong>Share</strong> <span aria-hidden="true">(the square with the arrow)</span> and
				choose
				<strong>Add to Home Screen</strong>, then open Budget from your home screen and come back
				here.
			</p>
		</section>
	{/if}

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="font-medium text-neutral-900 dark:text-neutral-50">Push notifications</h2>
		{#if !data.vapidPublicKey}
			<p class="mt-2 text-sm text-neutral-500">Push is not configured on this server.</p>
		{:else if permission === 'unsupported'}
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				This browser doesn't support push{showA2hs ? ' until the app is installed' : ''}.
			</p>
		{:else if permission === 'denied'}
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				Notifications are blocked for this site — enable them in your browser settings.
			</p>
		{:else if subscribed}
			<p class="mt-2 text-sm text-green-700 dark:text-green-400">✓ Enabled on this device</p>
			<button
				onclick={disablePush}
				disabled={busy}
				class="mt-3 text-sm text-neutral-500 underline hover:text-neutral-700"
			>
				Turn off on this device
			</button>
		{:else}
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				Get notified about approvals on this device.
			</p>
			<button
				onclick={enablePush}
				disabled={busy}
				class="mt-3 w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
			>
				Enable notifications
			</button>
		{/if}
		{#if pushError}
			<p class="mt-2 text-sm text-red-600 dark:text-red-400">{pushError}</p>
		{/if}
		{#if data.subscriptionCount > 0}
			<p class="mt-2 text-xs text-neutral-400">
				{data.subscriptionCount} device{data.subscriptionCount === 1 ? '' : 's'} registered
			</p>
		{/if}
	</section>

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="font-medium text-neutral-900 dark:text-neutral-50">ntfy</h2>
		<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
			Reliable delivery via the ntfy app — subscribe to your topic there.
		</p>
		<form method="POST" action="?/ntfy" use:enhance class="mt-3 space-y-3">
			<label class="block">
				<span class="text-xs text-neutral-500 dark:text-neutral-400">Server</span>
				<input
					name="serverUrl"
					value={data.ntfy.serverUrl}
					class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				/>
			</label>
			<label class="block">
				<span class="text-xs text-neutral-500 dark:text-neutral-400">
					Topic — treat it like a password
				</span>
				<input
					name="topic"
					value={data.ntfy.topic}
					class="mt-1 w-full rounded-lg border-neutral-200 bg-white font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				/>
			</label>
			<div class="flex items-center gap-3">
				<button
					class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
				>
					Save
				</button>
				<button
					formaction="?/ntfyTest"
					class="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-50"
				>
					Send test
				</button>
				{#if !data.ntfy.unsaved}
					<button
						formaction="?/ntfyOff"
						class="ml-auto text-sm text-neutral-400 hover:text-red-600"
					>
						Remove
					</button>
				{/if}
			</div>
		</form>
		{#if form?.section === 'ntfy'}
			{#if form.error}
				<p class="mt-2 text-sm text-red-600 dark:text-red-400">{form.error}</p>
			{:else if form.tested}
				<p class="mt-2 text-sm text-green-700 dark:text-green-400">
					Test sent — check the ntfy app.
				</p>
			{:else}
				<p class="mt-2 text-sm text-green-700 dark:text-green-400">Saved.</p>
			{/if}
		{/if}
	</section>

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="font-medium text-neutral-900 dark:text-neutral-50">What to send where</h2>
		<form method="POST" action="?/prefs" use:enhance class="mt-3 space-y-2">
			<div
				class="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm text-neutral-700 dark:text-neutral-300"
			>
				<span></span>
				<span class="text-xs font-medium text-neutral-400">Push</span>
				<span class="text-xs font-medium text-neutral-400">ntfy</span>
				{#each data.eventTypes as event (event.id)}
					<span>{event.label}</span>
					<input
						type="checkbox"
						name="enabled"
						value="{event.id}:webpush"
						checked={isEnabled(event.id, 'webpush')}
						class="justify-self-center rounded border-neutral-300 dark:border-neutral-600"
					/>
					<input
						type="checkbox"
						name="enabled"
						value="{event.id}:ntfy"
						checked={isEnabled(event.id, 'ntfy')}
						class="justify-self-center rounded border-neutral-300 dark:border-neutral-600"
					/>
				{/each}
			</div>
			<button
				class="mt-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
			>
				Save preferences
			</button>
			{#if form?.section === 'prefs' && form.ok}
				<span class="ml-2 text-sm text-green-700 dark:text-green-400">Saved.</span>
			{/if}
		</form>
	</section>
</div>
