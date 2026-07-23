<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { Bell, ChevronRight, CircleHelp, Monitor, Moon, Sparkles, Sun, Users } from '@lucide/svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import { theme, setTheme, type ThemePref } from '$lib/theme.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { accentFor } from '$lib/accent';
	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

	// Writable $derived: the picker reassigns it so the swatch responds instantly,
	// and it re-syncs to the stored value whenever the load data changes. The Save
	// button only appears once the two diverge.
	const currentAccent = $derived(accentFor({ slug: slug ?? '', accentColor: data.accentColor }));
	let accent = $derived(currentAccent);

	const themeOptions: { id: ThemePref; label: string; icon: typeof Sun }[] = [
		{ id: 'system', label: 'System', icon: Monitor },
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon }
	];

	let confirmingDelete = $state(false);
	let deleteConfirmText = $state('');
	// The workspace the delete confirmation was opened for, frozen at that moment
	// (not read live from data). It's submitted with the form and re-checked on
	// the server, so an armed delete can never act on a workspace you switched to.
	let armedWorkspaceId = $state<string | null>(null);

	function armDelete() {
		confirmingDelete = true;
		armedWorkspaceId = data.workspace.id;
		deleteConfirmText = '';
	}
	function disarmDelete() {
		confirmingDelete = false;
		deleteConfirmText = '';
		armedWorkspaceId = null;
	}

	// Belt to the server's braces: if the workspace changes while a delete is
	// armed — should never happen, since the layout recreates this page per
	// workspace, but this doesn't depend on that — disarm so no stale, dangerous
	// confirmation is ever left on screen.
	$effect(() => {
		if (confirmingDelete && armedWorkspaceId !== data.workspace.id) disarmDelete();
	});

	const memberSummary = $derived(
		`${data.memberCount} ${data.memberCount === 1 ? 'person' : 'people'} · approvals and invites`
	);
</script>

<div class="space-y-4">
	<h1 class="px-1 pt-1 text-[28px]">Settings</h1>

	<!-- Profile -->
	<div class="card flex items-center gap-3.5 p-4">
		<div
			class="flex h-12 w-12 items-center justify-center rounded-full font-[family-name:var(--font-display)] text-[22px] font-semibold text-white"
			style="background: color-mix(in oklab, var(--ws-accent) 80%, black)"
		>
			{data.user.displayName.charAt(0)}
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[17px] font-semibold" style="color: var(--ink)">
				{data.user.displayName}
			</p>
			<p class="text-[13px] capitalize" style="color: var(--ink-3)">
				{data.member.role} · {data.workspace.name}
			</p>
		</div>
		<form method="POST" action="/auth/logout">
			<button class="btn btn-ghost px-4 py-2 text-[14px]">Sign out</button>
		</form>
	</div>

	<!--
		One card for everything on your plate, not a stack of separate bubbles: two
		different to-dos (record what you paid; wait on / give a decision) read as a
		single "here's what needs you" so nothing is missed and nothing competes.
		Amber throughout — the shared "attention" colour — with the parts spelled
		out in the subtitle rather than colour-coded, which kept it calm.
	-->
	{#if data.confirmCount > 0 || data.pendingCount > 0}
		{@const total = data.confirmCount + data.pendingCount}
		{@const parts = [
			data.confirmCount > 0 ? `${data.confirmCount} to confirm` : null,
			data.pendingCount > 0 ? `${data.pendingCount} awaiting a decision` : null
		].filter(Boolean)}
		<a
			href="/w/{slug}/purchases"
			class="press card flex items-center gap-3.5 p-4"
			style="background: color-mix(in oklab, var(--pending) 12%, var(--surface))"
		>
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
				style="background: var(--pending)">{total}</span
			>
			<div class="flex-1">
				<p class="text-[15px] font-semibold" style="color: var(--pending)">Needs your attention</p>
				<p class="text-[13px]" style="color: var(--ink-3)">{parts.join(' · ')}</p>
			</div>
			<ChevronRight class="h-4 w-4" style="color: var(--pending)" />
		</a>
	{/if}

	<a href="/w/{slug}/settings/help" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<CircleHelp class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Help</p>
			<p class="text-[13px]" style="color: var(--ink-3)">Approvals, gift mode, buckets, budgets</p>
		</div>
		<ChevronRight class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	<a href="/w/{slug}/settings/notifications" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Bell class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Notifications</p>
			<p class="text-[13px]" style="color: var(--ink-3)">Push, ntfy, and per-event routing</p>
		</div>
		<ChevronRight class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	<a href="/w/{slug}/settings/api" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Sparkles class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="flex items-center gap-2 text-[15px] font-medium" style="color: var(--ink)">
				API &amp; MCP
				<span
					class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
					style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
					>Alpha</span
				>
			</p>
			<p class="text-[13px]" style="color: var(--ink-3)">Connect Claude or another assistant</p>
		</div>
		<ChevronRight class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	<a href="/w/{slug}/settings/members" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Users class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Members</p>
			<p class="text-[13px]" style="color: var(--ink-3)">{memberSummary}</p>
		</div>
		<ChevronRight class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	{#if form?.error}
		<div
			class="card p-4 text-[15px]"
			style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
		>
			{form.error}
		</div>
	{/if}

	<a href="/w/{slug}/settings/intelligence" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Sparkles class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="flex items-center gap-2 text-[15px] font-medium" style="color: var(--ink)">
				Harmony
				<span
					class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
					style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
					>Alpha</span
				>
			</p>
			<p class="text-[13px]" style="color: var(--ink-3)">
				Safe to Spend, bill reading, and optional AI assistance
			</p>
		</div>
		<ChevronRight class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	<div class="card flex items-center justify-between p-4">
		<div>
			<p class="text-[15px] font-medium" style="color: var(--ink)">Bucket charges</p>
			<p class="text-[13px]" style="color: var(--ink-3)">
				Skip approval for purchases charged to a bucket
			</p>
		</div>
		<Toggle
			on={data.bucketChargesSkipApproval}
			action="?/bucketSkipApproval"
			label="Toggle bucket charges skip approval"
		/>
	</div>

	<div class="card p-5">
		<p class="text-[15px] font-medium" style="color: var(--ink)">Appearance</p>
		<p class="mt-0.5 mb-3.5 text-[13px]" style="color: var(--ink-3)">
			Follows your device by default. Saved on this device.
		</p>
		<div
			class="flex gap-1 rounded-[var(--r-md)] p-1"
			role="radiogroup"
			aria-label="Theme"
			style="background: var(--surface-2)"
		>
			{#each themeOptions as opt (opt.id)}
				{@const active = theme.pref === opt.id}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					onclick={() => setTheme(opt.id)}
					class="press flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-sm)] py-2 text-[13px] font-medium"
					style={active
						? 'background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card)'
						: 'color: var(--ink-3)'}
				>
					<opt.icon class="h-4 w-4" />
					{opt.label}
				</button>
			{/each}
		</div>
	</div>

	{#if data.member.role === 'owner'}
		<div class="card p-5">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Accent</p>
			<p class="mt-0.5 mb-3.5 text-[13px]" style="color: var(--ink-3)">
				Colors this workspace everywhere. Each workspace keeps its own.
			</p>
			<form method="POST" action="?/accent" use:submit={{ success: 'Accent updated' }}>
				<AccentPicker bind:value={accent} label="" />
				<input type="hidden" name="accentColor" value={accent} />
				{#if accent !== currentAccent}
					<button class="btn btn-tint mt-3.5 px-4 py-2 text-[14px]">Save accent</button>
				{/if}
			</form>
		</div>

		<!--
			Danger zone. Collapsed by default so the delete control isn't sitting
			under your thumb during ordinary settings changes — you have to open it,
			type the exact name, and clear a confirm. Three deliberate acts for one
			irreversible one.
		-->
		<div
			class="card p-5"
			style="box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--deny) 30%, transparent)"
		>
			<p class="text-[15px] font-medium" style="color: var(--deny)">Danger zone</p>
			<p class="mt-0.5 text-[13px]" style="color: var(--ink-3)">
				Permanently removes {data.workspace.name} — every purchase, bucket, budget and member. This cannot
				be undone.
			</p>

			{#if !confirmingDelete}
				<button
					onclick={armDelete}
					class="press mt-3.5 rounded-[var(--r-sm)] px-4 py-2 text-[14px] font-medium"
					style="color: var(--deny); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--deny) 40%, transparent)"
				>
					Delete this workspace…
				</button>
			{:else}
				<form
					method="POST"
					action="?/deleteWorkspace"
					use:submit={{
						confirm: `Delete ${data.workspace.name} and everything in it? This cannot be undone.`
					}}
					class="mt-3.5 space-y-3"
				>
					<input type="hidden" name="workspaceId" value={armedWorkspaceId} />
					<label class="block">
						<span class="text-[13px]" style="color: var(--ink-3)">
							Type <strong style="color: var(--ink)">{data.workspace.name}</strong> to confirm
						</span>
						<input
							name="confirmName"
							bind:value={deleteConfirmText}
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							class="field mt-1.5 text-[16px]"
							placeholder={data.workspace.name}
						/>
					</label>
					<div class="flex gap-2">
						<button
							disabled={deleteConfirmText.trim() !== data.workspace.name}
							class="press rounded-[var(--r-sm)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40"
							style="background: var(--deny)"
						>
							Delete forever
						</button>
						<button
							type="button"
							onclick={disarmDelete}
							class="press rounded-[var(--r-sm)] px-4 py-2 text-[14px]"
							style="color: var(--ink-3)"
						>
							Cancel
						</button>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	<p class="pt-2 text-center text-[12px]" style="color: var(--ink-3)">Ledger v{data.version}</p>
</div>
