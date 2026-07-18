<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();

	let editingPolicy: string | null = $state(null);

	const roleLabel: Record<string, string> = { owner: 'Owner', member: 'Member' };

	function expiresIn(iso: string): string {
		const days = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 86_400_000));
		return days <= 1 ? 'expires soon' : `expires in ${days} days`;
	}

	function policySummary(p: { mode: string; threshold_minor?: number }): string {
		if (p.mode === 'none') return 'No approval needed';
		if (p.mode === 'always') return 'Always needs approval';
		return `Needs approval from ${formatMinor(BigInt(p.threshold_minor ?? 0), data.workspace.currency)}`;
	}
</script>

<div class="space-y-6">
	<a
		href="/w/{data.workspace.slug}/purchases"
		class="block rounded-2xl bg-white p-5 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
	>
		<div class="flex items-center justify-between">
			<div>
				<h2 class="font-medium text-neutral-900 dark:text-neutral-50">Purchases</h2>
				<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
					{data.pendingCount === 0
						? 'Nothing waiting for approval'
						: `${data.pendingCount} waiting for approval`}
				</p>
			</div>
			{#if data.pendingCount > 0}
				<span
					class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
				>
					{data.pendingCount}
				</span>
			{/if}
		</div>
	</a>

	<a
		href="/w/{data.workspace.slug}/analytics"
		class="block rounded-2xl bg-white p-5 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
	>
		<h2 class="font-medium text-neutral-900 dark:text-neutral-50">📊 Analytics</h2>
		<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
			This month vs last, categories, budgets
		</p>
	</a>

	<div class="grid grid-cols-2 gap-4">
		<a
			href="/w/{data.workspace.slug}/recurring"
			class="block rounded-2xl bg-white p-5 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
		>
			<h2 class="font-medium text-neutral-900 dark:text-neutral-50">🔁 Recurring</h2>
			<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Repeating charges</p>
		</a>
		<a
			href="/w/{data.workspace.slug}/income"
			class="block rounded-2xl bg-white p-5 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
		>
			<h2 class="font-medium text-neutral-900 dark:text-neutral-50">💰 Income</h2>
			<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Salary and inflows</p>
		</a>
	</div>

	{#if form?.error}
		<p
			class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
		>
			{form.error}
		</p>
	{/if}

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Members</h2>
		<ul class="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
			{#each data.members as m (m.id)}
				<li class="py-2.5">
					<div class="flex items-center justify-between">
						<div>
							<span class="font-medium text-neutral-900 dark:text-neutral-50">{m.displayName}</span>
							<span class="ml-2 text-sm text-neutral-500 dark:text-neutral-400">
								{roleLabel[m.role] ?? m.role}{m.status !== 'active' ? ` · ${m.status}` : ''}
							</span>
							<p class="text-sm text-neutral-400 dark:text-neutral-500">
								{policySummary(m.policy)}
							</p>
						</div>
						{#if data.member.role === 'owner'}
							<button
								onclick={() => (editingPolicy = editingPolicy === m.id ? null : m.id)}
								class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
							>
								{editingPolicy === m.id ? 'Close' : 'Policy'}
							</button>
						{/if}
					</div>
					{#if editingPolicy === m.id}
						<form
							method="POST"
							action="?/policy"
							use:enhance
							class="mt-3 space-y-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/60"
						>
							<input type="hidden" name="memberId" value={m.id} />
							<div class="grid grid-cols-2 gap-3">
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">Approval</span>
									<select
										name="mode"
										value={m.policy.mode}
										class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
									>
										<option value="none">Never needed</option>
										<option value="threshold">Above an amount</option>
										<option value="always">Always needed</option>
									</select>
								</label>
								<label class="block">
									<span class="text-xs text-neutral-500 dark:text-neutral-400">
										Threshold ({data.workspace.currency})
									</span>
									<input
										name="threshold"
										inputmode="decimal"
										placeholder="50.00"
										value={m.policy.threshold_minor !== undefined
											? (m.policy.threshold_minor / 100).toFixed(2)
											: ''}
										class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
									/>
								</label>
							</div>
							<label class="block">
								<span class="text-xs text-neutral-500 dark:text-neutral-400">Routing</span>
								<select
									name="routingMode"
									value={m.policy.routing.mode}
									class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
								>
									<option value="any_of">Any listed approver may decide</option>
									<option value="specific">Exactly one specific approver</option>
								</select>
							</label>
							<fieldset>
								<legend class="text-xs text-neutral-500 dark:text-neutral-400">Approvers</legend>
								<div class="mt-1 flex flex-wrap gap-3">
									{#each data.members.filter((x) => x.status === 'active') as a (a.id)}
										<label
											class="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300"
										>
											<input
												type="checkbox"
												name="approverIds"
												value={a.id}
												checked={m.policy.routing.approver_ids.includes(a.id)}
												class="rounded border-neutral-300 dark:border-neutral-600"
											/>
											{a.displayName}
										</label>
									{/each}
								</div>
							</fieldset>
							<button
								class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
							>
								Save policy
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	{#if data.member.role === 'owner'}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Invites</h2>
				<form method="POST" action="?/invite" use:enhance>
					<button
						class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
					>
						New invite
					</button>
				</form>
			</div>
			{#if data.invites.length === 0}
				<p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">
					No open invites. Create one and share the code.
				</p>
			{:else}
				<ul class="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
					{#each data.invites as inv (inv.code)}
						<li class="flex items-center justify-between py-2.5">
							<code class="font-mono text-sm tracking-widest text-neutral-900 dark:text-neutral-50">
								{inv.code}
							</code>
							<span class="text-sm text-neutral-400">{expiresIn(inv.expiresAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
