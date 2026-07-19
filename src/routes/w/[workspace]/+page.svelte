<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { money } from '$lib/actions/money';
	import { formatMinor } from '$lib/money-format';
	import Icon from '$lib/components/Icon.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import { accentFor } from '$lib/accent';
	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

	// Writable $derived: the picker reassigns it so the swatch responds instantly,
	// and it re-syncs to the stored value whenever the load data changes. The Save
	// button only appears once the two diverge.
	const currentAccent = $derived(accentFor({ slug: slug ?? '', accentColor: data.accentColor }));
	let accent = $derived(currentAccent);
	let editingPolicy: string | null = $state(null);
	let copied: string | null = $state(null);

	const roleLabel: Record<string, string> = { owner: 'Owner', member: 'Member' };

	function expiresIn(iso: string) {
		const ts = Date.parse(iso);
		if (Number.isNaN(ts)) return 'Invalid date';
		const d = Math.max(0, Math.round((ts - Date.now()) / 86400000));
		return d <= 1 ? 'Expires soon' : `Expires in ${d} days`;
	}
	function policySummary(p: { mode: string; threshold_minor?: number | null }) {
		if (p.mode === 'none') return 'No approval needed';
		if (p.mode === 'always') return 'Always needs approval';
		const minor = p.threshold_minor ?? 0;
		return `Approval above ${formatMinor(BigInt(minor), data.workspace.currency)}`;
	}
	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copied = code;
			setTimeout(() => (copied = copied === code ? null : copied), 1400);
		} catch {
			/* clipboard may be unavailable */
		}
	}
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
			<p class="text-[13px] capitalize" style="color: var(--ink-4)">
				{data.member.role} · {data.workspace.name}
			</p>
		</div>
		<form method="POST" action="/auth/logout">
			<button class="btn btn-ghost px-4 py-2 text-[14px]">Sign out</button>
		</form>
	</div>

	{#if data.pendingCount > 0}
		<a
			href="/w/{slug}/purchases"
			class="press card flex items-center gap-3.5 p-4"
			style="background: color-mix(in oklab, var(--pending) 12%, var(--surface))"
		>
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
				style="background: var(--pending)">{data.pendingCount}</span
			>
			<div class="flex-1">
				<p class="text-[15px] font-semibold" style="color: var(--pending)">
					{data.pendingCount} awaiting a decision
				</p>
				<p class="text-[13px]" style="color: var(--ink-3)">Tap to review in your Ledger</p>
			</div>
			<Icon name="chevronRight" class="h-4 w-4" style="color: var(--pending)" />
		</a>
	{/if}

	<a href="/w/{slug}/settings/help" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Icon name="question" class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Help</p>
			<p class="text-[13px]" style="color: var(--ink-4)">Approvals, gift mode, buckets, budgets</p>
		</div>
		<Icon name="chevronRight" class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	<a href="/w/{slug}/settings/notifications" class="press card flex items-center gap-3.5 p-4">
		<span
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
			style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
		>
			<Icon name="bell" class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
		</span>
		<div class="flex-1">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Notifications</p>
			<p class="text-[13px]" style="color: var(--ink-4)">Push, ntfy, and per-event routing</p>
		</div>
		<Icon name="chevronRight" class="h-4 w-4" style="color: var(--ink-4)" />
	</a>

	{#if form?.error}
		<div
			class="card p-4 text-[15px]"
			style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
		>
			{form.error}
		</div>
	{/if}

	<!-- Members -->
	<div class="card p-5">
		<p class="section-label">Members</p>
		<div class="mt-1">
			{#each data.members as m (m.id)}
				<!-- One wrapper per member: the row and its policy editor belong
				     together, and without it nothing scopes to a single member. -->
				<div data-member={m.displayName}>
					<div class="hairline flex items-center justify-between py-3 last:shadow-none">
						<div class="min-w-0">
							<p class="text-[16px]" style="color: var(--ink)">
								{m.displayName}
								<span class="ml-1 text-[13px]" style="color: var(--ink-4)"
									>{roleLabel[m.role]}{m.status !== 'active' ? ` · ${m.status}` : ''}</span
								>
							</p>
							<p class="text-[13px]" style="color: var(--ink-4)">{policySummary(m.policy)}</p>
						</div>
						{#if data.member.role === 'owner'}
							<button
								onclick={() => (editingPolicy = editingPolicy === m.id ? null : m.id)}
								class="press shrink-0 text-[13px] font-medium"
								style="color: var(--ws-accent)">{editingPolicy === m.id ? 'Done' : 'Policy'}</button
							>
						{/if}
					</div>
					{#if editingPolicy === m.id}
						<form
							method="POST"
							action="?/policy"
							use:submit={{ success: 'Policy updated' }}
							class="mt-1 mb-2 space-y-3 rounded-[14px] p-4"
							style="background: var(--surface-2)"
						>
							<input type="hidden" name="memberId" value={m.id} />
							<div class="grid grid-cols-2 gap-3">
								<select
									name="mode"
									aria-label="Approval"
									value={m.policy.mode}
									class="field text-[16px]"
								>
									<option value="none">Never</option>
									<option value="threshold">Above amount</option>
									<option value="always">Always</option>
								</select>
								<input
									name="threshold"
									aria-label="Threshold"
									use:money
									inputmode="decimal"
									placeholder="50.00"
									value={m.policy.threshold_minor !== undefined
										? (m.policy.threshold_minor / 100).toFixed(2)
										: ''}
									class="field text-[16px] tabular-nums"
								/>
							</div>
							<select
								name="routingMode"
								aria-label="Routing"
								value={m.policy.routing.mode}
								class="field text-[16px]"
							>
								<option value="any_of">Any approver can decide</option>
								<option value="specific">One specific approver</option>
							</select>
							<div class="flex flex-wrap gap-x-4 gap-y-2">
								{#each data.members.filter((x: { status: string }) => x.status === 'active') as a (a.id)}
									<label class="flex items-center gap-1.5 text-[15px]" style="color: var(--ink)">
										<input
											type="checkbox"
											name="approverIds"
											value={a.id}
											checked={m.policy.routing.approver_ids.includes(a.id)}
										/>
										{a.displayName}
									</label>
								{/each}
							</div>
							<button class="btn btn-accent px-5 py-2.5 text-[15px]">Save policy</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="card flex items-center justify-between p-4">
		<div>
			<p class="text-[15px] font-medium" style="color: var(--ink)">Bucket charges</p>
			<p class="text-[13px]" style="color: var(--ink-4)">
				Skip approval for purchases charged to a bucket
			</p>
		</div>
		<form method="POST" action="?/bucketSkipApproval" use:submit={{ success: 'Setting saved' }}>
			<button
				name="enabled"
				value={data.bucketChargesSkipApproval ? 'false' : 'true'}
				aria-label="Toggle bucket charges skip approval"
				class="press relative inline-flex h-7 w-11 items-center rounded-full transition-colors"
				style="background: {data.bucketChargesSkipApproval
					? 'var(--approve)'
					: 'var(--surface-hi)'}"
			>
				<span
					class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
					style="transform: translateX({data.bucketChargesSkipApproval ? '22px' : '2px'})"
				></span>
			</button>
		</form>
	</div>

	{#if data.member.role === 'owner'}
		<div class="card p-5">
			<p class="text-[15px] font-medium" style="color: var(--ink)">Accent</p>
			<p class="mt-0.5 mb-3.5 text-[13px]" style="color: var(--ink-4)">
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

		<div class="card p-5">
			<div class="flex items-center justify-between">
				<p class="section-label">Invites</p>
				<form method="POST" action="?/invite" use:submit={{ success: 'Invite created' }}>
					<button class="btn btn-tint px-4 py-1.5 text-[13px]">New code</button>
				</form>
			</div>
			{#if data.invites.length === 0}
				<p class="mt-3 text-[15px]" style="color: var(--ink-4)">
					No open invites. Create a code to add someone.
				</p>
			{:else}
				<div class="mt-1">
					{#each data.invites as inv (inv.code)}
						<button
							onclick={() => copyCode(inv.code)}
							class="press hairline flex w-full items-center justify-between py-3 last:shadow-none"
						>
							<code class="font-mono text-[16px] tracking-[0.12em]" style="color: var(--ink)"
								>{inv.code}</code
							>
							<span
								class="text-[13px]"
								style="color: {copied === inv.code ? 'var(--approve)' : 'var(--ink-4)'}"
							>
								{copied === inv.code ? 'Copied ✓' : expiresIn(inv.expiresAt)}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<p class="pt-2 text-center text-[12px]" style="color: var(--ink-4)">Ledger v{data.version}</p>
</div>
