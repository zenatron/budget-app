<script lang="ts">
	import { formatMinor } from '$lib/money-format';

	let { data } = $props();

	const stateBadge: Record<string, { label: string; cls: string }> = {
		pending_approval: {
			label: 'Pending',
			cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
		},
		approved: {
			label: 'Approved',
			cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
		},
		denied: {
			label: 'Denied',
			cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
		},
		cancelled: {
			label: 'Cancelled',
			cls: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
		},
		completed: { label: '', cls: '' },
		refunded: {
			label: 'Refunded',
			cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
		},
		draft: {
			label: 'Draft',
			cls: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
		}
	};
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Purchases</h1>
		<a
			href="/w/{data.workspace.slug}/purchases/new"
			class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
		>
			New
		</a>
	</div>

	{#if data.purchases.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-neutral-900">
			<p class="text-3xl">🧾</p>
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				Nothing yet. Log a purchase or request an approval.
			</p>
		</div>
	{:else}
		<ul
			class="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm dark:divide-neutral-800 dark:bg-neutral-900"
		>
			{#each data.purchases as p (p.id)}
				<li>
					<a
						href="/w/{data.workspace.slug}/purchases/{p.id}"
						class="flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
					>
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
							style="background-color: {p.categoryColor ?? '#e5e5e5'}20"
						>
							{p.categoryIcon ?? '💳'}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-neutral-900 dark:text-neutral-50">
								{p.itemName}
							</span>
							<span class="block truncate text-sm text-neutral-500 dark:text-neutral-400">
								{p.requesterName}{p.state === 'pending_approval' && p.waitingDays > 0
									? ` · waiting ${p.waitingDays} day${p.waitingDays === 1 ? '' : 's'}`
									: ''}
							</span>
						</span>
						{#if p.recurring}
							<span title="Recurring">🔁</span>
						{/if}
						{#if p.sealed}
							<span title="Sealed — hidden from some members">🔒</span>
						{/if}
						{#if p.stale}
							<span class="text-amber-500" title="Waiting a long time">⏳</span>
						{/if}
						{#if stateBadge[p.state].label}
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {stateBadge[p.state].cls}">
								{stateBadge[p.state].label}
							</span>
						{/if}
						{#if p.state === 'pending_approval' && p.canDecide}
							<span
								class="rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-neutral-50 dark:text-neutral-900"
							>
								Decide
							</span>
						{/if}
						<span class="font-medium text-neutral-900 tabular-nums dark:text-neutral-50">
							{formatMinor(p.amountMinor, p.currency)}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
