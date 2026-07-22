<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { Check, ChevronLeft, CircleAlert } from '@lucide/svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

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
		showA2hs = isIos && !standalone;

		if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
			permission = Notification.permission;
			navigator.serviceWorker.ready.then(async (reg) => {
				subscribed = (await reg.pushManager.getSubscription()) !== null;
			});
		}
	});

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

	// ntfy delivers nothing until a topic is saved, so its column is inert until
	// then — showing it as tickable invited people to configure a dead channel.
	const ntfyConfigured = $derived(!data.ntfy.unsaved);
</script>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[15px]"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>
	<h1 class="px-1 text-[28px]">Notifications</h1>

	{#if showA2hs}
		<section
			class="card p-4"
			style="background: color-mix(in oklab, var(--pending) 12%, var(--surface))"
		>
			<h2
				class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[15px] font-semibold tracking-normal"
				style="color: var(--pending)"
			>
				<CircleAlert class="h-4 w-4" /> Install the app first
			</h2>
			<p class="mt-1.5 text-[13px] leading-relaxed" style="color: var(--ink-2)">
				On iPhone, notifications only work for installed apps. In Safari, tap
				<strong style="color: var(--ink)">Share</strong> (the square with the arrow) and choose
				<strong style="color: var(--ink)">Add to Home Screen</strong>, then open Ledger from your
				home screen and come back here.
			</p>
		</section>
	{/if}

	<section class="card p-5">
		<h2
			class="font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			Push on this device
		</h2>
		{#if !data.vapidPublicKey}
			<p class="mt-2 text-[14px]" style="color: var(--ink-4)">
				Push is not configured on this server.
			</p>
		{:else if permission === 'unsupported'}
			<p class="mt-2 text-[14px]" style="color: var(--ink-3)">
				This browser doesn't support push{showA2hs ? ' until the app is installed' : ''}.
			</p>
		{:else if permission === 'denied'}
			<p class="mt-2 text-[14px]" style="color: var(--ink-3)">
				Notifications are blocked — enable them in your browser settings.
			</p>
		{:else if subscribed}
			<p class="mt-2 flex items-center gap-1.5 text-[14px]" style="color: var(--approve)">
				<Check class="h-4 w-4" /> Enabled on this device
			</p>
			<button
				onclick={disablePush}
				disabled={busy}
				class="btn btn-plain mt-2"
				style="color: var(--ink-3)"
			>
				Turn off on this device
			</button>
		{:else}
			<p class="mt-2 text-[14px]" style="color: var(--ink-3)">Get notified about approvals here.</p>
			<button
				onclick={enablePush}
				disabled={busy}
				class="btn btn-accent mt-3 w-full disabled:opacity-50"
			>
				Enable notifications
			</button>
		{/if}
		{#if pushError}
			<p class="mt-2 text-[13px]" style="color: var(--deny)">{pushError}</p>
		{/if}
		{#if data.subscriptionCount > 0}
			<p class="mt-2 text-[12px]" style="color: var(--ink-4)">
				{data.subscriptionCount} device{data.subscriptionCount === 1 ? '' : 's'} registered
			</p>
		{/if}
	</section>

	<section class="card p-5">
		<h2
			class="font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			ntfy
		</h2>
		<p class="mt-1 text-[13px]" style="color: var(--ink-3)">
			Reliable delivery via the ntfy app — subscribe to your topic there.
		</p>
		<form method="POST" action="?/ntfy" use:submit class="mt-3.5 space-y-3">
			<label class="block">
				<span class="text-[12px]" style="color: var(--ink-4)">Server</span>
				<input name="serverUrl" value={data.ntfy.serverUrl} class="field mt-1 text-[16px]" />
			</label>
			<label class="block">
				<span class="text-[12px]" style="color: var(--ink-4)">Topic — treat it like a password</span
				>
				<input name="topic" value={data.ntfy.topic} class="field mt-1 font-mono text-[16px]" />
			</label>
			<div class="flex flex-wrap items-center gap-2.5">
				<button class="btn btn-accent px-4 py-2 text-[14px]">Save</button>
				<button formaction="?/ntfyTest" class="btn btn-ghost px-4 py-2 text-[14px]"
					>Send test</button
				>
				{#if !data.ntfy.unsaved}
					<button formaction="?/ntfyOff" class="btn btn-plain ml-auto" style="color: var(--ink-4)">
						Remove
					</button>
				{/if}
			</div>
		</form>
		{#if form?.section === 'ntfy'}
			{#if form.error}
				<p class="mt-2 text-[13px]" style="color: var(--deny)">{form.error}</p>
			{:else if form.tested}
				<p class="mt-2 text-[13px]" style="color: var(--approve)">
					Test sent — check the ntfy app.
				</p>
			{:else}
				<p class="mt-2 text-[13px]" style="color: var(--approve)">Saved.</p>
			{/if}
		{/if}
	</section>

	<section class="card p-5">
		<h2
			class="font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			What to send where
		</h2>
		<form
			method="POST"
			action="?/prefs"
			use:submit={{ success: 'Preferences saved' }}
			class="mt-3.5"
		>
			<div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 text-[15px]">
				<span></span>
				<span class="w-11 text-center text-[12px] font-semibold" style="color: var(--ink-3)"
					>Push</span
				>
				<span
					class="w-11 text-center text-[12px] font-semibold"
					style="color: {ntfyConfigured ? 'var(--ink-3)' : 'var(--ink-4)'}">ntfy</span
				>
				{#each data.eventTypes as event, i (event.id)}
					<span
						class="py-1"
						style="color: var(--ink-2); {i > 0
							? 'box-shadow: inset 0 0.5px 0 var(--hairline);'
							: ''}">{event.label}</span
					>
					<!--
						Wrapped in labels purely for the tap target: the box itself is 17px,
						and these sit shoulder to shoulder in a dense grid, so bare inputs
						made it easy to toggle the wrong channel on a phone.
					-->
					<label
						class="flex cursor-pointer justify-center py-2"
						style={i > 0 ? 'box-shadow: inset 0 0.5px 0 var(--hairline)' : ''}
					>
						<span class="sr-only">{event.label} — push</span>
						<input
							type="checkbox"
							name="enabled"
							value="{event.id}:webpush"
							checked={isEnabled(event.id, 'webpush')}
						/>
					</label>
					<!-- ntfy disabled until a topic is saved, so it can't be armed for a
					     channel that would drop the message. -->
					<label
						class="flex justify-center py-2 {ntfyConfigured ? 'cursor-pointer' : 'cursor-default'}"
						style="opacity: {ntfyConfigured ? 1 : 0.4}; {i > 0
							? 'box-shadow: inset 0 0.5px 0 var(--hairline)'
							: ''}"
					>
						<span class="sr-only">{event.label} — ntfy</span>
						<input
							type="checkbox"
							name="enabled"
							value="{event.id}:ntfy"
							checked={ntfyConfigured && isEnabled(event.id, 'ntfy')}
							disabled={!ntfyConfigured}
						/>
					</label>
				{/each}
			</div>
			{#if !ntfyConfigured}
				<p class="mt-2 text-[12px]" style="color: var(--ink-4)">
					Save an ntfy topic above to send to that column.
				</p>
			{/if}
			<div class="mt-4 flex items-center gap-3">
				<button class="btn btn-accent px-4 py-2 text-[14px]">Save preferences</button>
				{#if form?.section === 'prefs' && form.ok}
					<span class="text-[14px]" style="color: var(--approve)">Saved.</span>
				{/if}
			</div>
		</form>
	</section>

	{#if data.intelligenceEnabled}
		<section class="card p-5">
			<h2
				class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
				style="color: var(--ink)"
			>
				Spending summary
				<span
					class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
					style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
					>Alpha</span
				>
			</h2>
			<p class="mt-1 text-[13px]" style="color: var(--ink-3)">
				A short digest of your spending — total, top category and net — sent to your notifications.
				It’s your own view, so sealed purchases stay hidden.
			</p>
			<form
				method="POST"
				action="?/summary"
				use:submit={{ success: 'Summary updated' }}
				class="mt-3.5"
			>
				<!--
					Segmented control, not the checkbox matrix: this is a frequency, not a
					per-channel on/off, and it delivers wherever your other notifications go.
				-->
				<div class="inline-flex rounded-[12px] p-1" style="background: var(--surface-2)">
					{#each [{ v: 'off', l: 'Off' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }] as opt (opt.v)}
						{@const active = data.summaryCadence === opt.v}
						<button
							name="cadence"
							value={opt.v}
							class="press rounded-[9px] px-4 py-1.5 text-[14px] font-semibold transition-colors"
							style="color: {active ? 'var(--ink)' : 'var(--ink-3)'}; background: {active
								? 'var(--surface)'
								: 'transparent'}; box-shadow: {active
								? 'var(--shadow-card), inset 0 0 0 0.5px var(--hairline)'
								: 'none'}"
						>
							{opt.l}
						</button>
					{/each}
				</div>
				{#if data.summaryCadence !== 'off'}
					<p class="mt-2.5 text-[12px]" style="color: var(--ink-4)">
						Arrives at the start of each {data.summaryCadence === 'weekly' ? 'week' : 'month'}, for
						the one just ended.
					</p>
				{/if}
			</form>
		</section>
	{/if}
</div>
