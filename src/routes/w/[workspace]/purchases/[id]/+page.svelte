<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();

	let editing = $state(false);

	const p = $derived(data.purchase);

	const stateCopy: Record<string, string> = {
		draft: 'Draft',
		pending_approval: 'Waiting for approval',
		approved: 'Approved — not yet bought',
		denied: 'Denied',
		cancelled: 'Cancelled',
		completed: 'Completed',
		refunded: 'Refunded'
	};

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="mx-auto max-w-md space-y-4">
	<a
		href="/w/{data.workspace.slug}/purchases"
		class="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
	>
		← Purchases
	</a>

	{#if data.images.length > 0}
		<div class="grid grid-cols-2 gap-2">
			{#each data.images as img (img.id)}
				<a href="/w/{data.workspace.slug}/blobs/{img.blobId}" target="_blank">
					<img
						src="/w/{data.workspace.slug}/blobs/{img.thumbBlobId}"
						alt={p.itemName}
						width={img.width}
						height={img.height}
						class="w-full rounded-xl object-cover shadow-sm"
						loading="lazy"
					/>
				</a>
			{/each}
		</div>
	{/if}

	<section class="rounded-2xl bg-white p-6 shadow-sm dark:bg-neutral-900">
		<p class="text-sm text-neutral-500 dark:text-neutral-400">{stateCopy[p.state]}</p>
		<h1 class="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">{p.itemName}</h1>
		<p class="mt-2 text-3xl font-semibold text-neutral-900 tabular-nums dark:text-neutral-50">
			{formatMinor(p.finalAmountMinor ?? p.requestedAmountMinor, p.currency)}
		</p>

		{#if p.isOverageReapproval && p.approvedAmountMinor !== null}
			<p
				class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
			>
				Spent {formatMinor(p.finalAmountMinor!, p.currency)} against an approved
				{formatMinor(p.approvedAmountMinor, p.currency)} — needs re-approval.
			</p>
		{/if}

		<dl class="mt-4 space-y-1 text-sm">
			<div class="flex justify-between">
				<dt class="text-neutral-500 dark:text-neutral-400">Requested by</dt>
				<dd class="text-neutral-900 dark:text-neutral-50">{p.requesterName}</dd>
			</div>
			{#if p.state === 'pending_approval'}
				<div class="flex justify-between">
					<dt class="text-neutral-500 dark:text-neutral-400">Waiting on</dt>
					<dd class="text-neutral-900 dark:text-neutral-50">
						{p.approverNames.join(' or ')}{p.waitingDays > 0 ? ` · ${p.waitingDays}d` : ''}
						{p.stale ? ' ⏳' : ''}
					</dd>
				</div>
			{/if}
			{#if p.approvedAmountMinor !== null && !p.isOverageReapproval}
				<div class="flex justify-between">
					<dt class="text-neutral-500 dark:text-neutral-400">Approved amount</dt>
					<dd class="text-neutral-900 tabular-nums dark:text-neutral-50">
						{formatMinor(p.approvedAmountMinor, p.currency)}
					</dd>
				</div>
			{/if}
			{#if p.completedAt}
				<div class="flex justify-between">
					<dt class="text-neutral-500 dark:text-neutral-400">Bought</dt>
					<dd class="text-neutral-900 dark:text-neutral-50">{fmtDate(p.completedAt)}</dd>
				</div>
			{/if}
			{#if p.note}
				<div class="pt-2">
					<dd class="text-neutral-700 dark:text-neutral-300">{p.note}</dd>
				</div>
			{/if}
		</dl>
	</section>

	{#if p.sealed}
		<section
			class="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900/60"
		>
			<p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
				🔒 Hidden from {p.sealedFromNames.join(' and ')} until {fmtDate(p.sealedUntil!)}
			</p>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
				They can't see this purchase anywhere — including totals — until then.
			</p>
			{#if data.can.unseal}
				<form method="POST" action="?/unseal" use:enhance class="mt-3">
					<button class="text-sm font-medium text-neutral-500 underline hover:text-neutral-700">
						Reveal now
					</button>
				</form>
			{/if}
		</section>
	{/if}

	{#if form?.error}
		<p
			class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
		>
			{form.error}
		</p>
	{/if}

	{#if data.can.decide}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<div class="grid grid-cols-2 gap-3">
				<form method="POST" action="?/approve" use:enhance>
					<button
						class="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
					>
						Approve
					</button>
				</form>
				<form method="POST" action="?/deny" use:enhance class="space-y-2">
					<button
						class="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
					>
						Deny
					</button>
					<input
						name="reason"
						placeholder="Reason (optional)"
						class="w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</form>
			</div>
		</section>
	{/if}

	{#if data.can.complete}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Mark as bought</h2>
			<form method="POST" action="?/complete" use:enhance class="mt-3 space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<input
						name="finalAmount"
						required
						inputmode="decimal"
						placeholder="Final amount"
						value={formatMinor(p.approvedAmountMinor ?? p.requestedAmountMinor, p.currency).replace(
							/[^0-9.]/g,
							''
						)}
						class="rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
					<input
						name="finalDate"
						type="date"
						class="rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</div>
				<button
					class="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
				>
					Complete purchase
				</button>
			</form>
		</section>
	{/if}

	{#if data.can.edit}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<button
				onclick={() => (editing = !editing)}
				class="text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
			>
				{editing ? 'Close edit' : 'Edit'}
			</button>
			{#if editing}
				{#if p.state === 'approved'}
					<p class="mt-2 text-sm text-amber-700 dark:text-amber-400">
						Changing the item, amount, or category sends this back for approval.
					</p>
				{/if}
				<form method="POST" action="?/edit" use:enhance class="mt-3 space-y-3">
					<input
						name="itemName"
						required
						value={p.itemName}
						class="w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
					<div class="grid grid-cols-2 gap-3">
						<input
							name="amount"
							required
							inputmode="decimal"
							value={formatMinor(p.requestedAmountMinor, p.currency).replace(/[^0-9.]/g, '')}
							class="rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						/>
						<select
							name="categoryId"
							class="rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						>
							<option value="">No category</option>
							{#each data.categories as c (c.id)}
								<option value={c.id} selected={c.id === p.categoryId}>{c.icon} {c.name}</option>
							{/each}
						</select>
					</div>
					<textarea
						name="note"
						rows="2"
						class="w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						>{p.note ?? ''}</textarea
					>
					<button
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-900 transition active:scale-[0.98] dark:border-neutral-700 dark:text-neutral-50"
					>
						Save changes
					</button>
				</form>
			{/if}
		</section>
	{/if}

	{#if data.can.edit}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Add a photo</h2>
			<form
				method="POST"
				action="?/addImage"
				enctype="multipart/form-data"
				use:enhance
				class="mt-3 flex items-center gap-3"
			>
				<input
					type="file"
					name="photo"
					accept="image/jpeg,image/png,image/webp"
					required
					class="flex-1 text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-neutral-400 dark:file:bg-neutral-800"
				/>
				<button
					class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
				>
					Upload
				</button>
			</form>
		</section>
	{/if}

	{#if data.can.refund}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Record a refund</h2>
			<form method="POST" action="?/refund" use:enhance class="mt-3 flex items-center gap-2">
				<input
					name="refundAmount"
					required
					inputmode="decimal"
					placeholder="Amount returned"
					class="flex-1 rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				/>
				<button
					class="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-50"
				>
					Record refund
				</button>
			</form>
			<p class="mt-2 text-xs text-neutral-400">Adds a negative entry — history is never deleted.</p>
		</section>
	{/if}

	{#if data.can.cancel}
		<form method="POST" action="?/cancel" use:enhance class="text-center">
			<button class="text-sm text-neutral-400 hover:text-red-600">Cancel this purchase</button>
		</form>
	{/if}

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">History</h2>
		<ol class="mt-2 space-y-2">
			{#each data.events as e, i (i)}
				<li class="flex items-baseline justify-between text-sm">
					<span class="text-neutral-700 dark:text-neutral-300">
						{stateCopy[e.toState]}{e.actorName ? ` — ${e.actorName}` : ''}{e.reason
							? ` (${e.reason})`
							: ''}
					</span>
					<span class="shrink-0 pl-3 text-neutral-400 tabular-nums">
						{fmtDate(e.at)}{e.amountMinor !== null
							? ` · ${formatMinor(e.amountMinor, p.currency)}`
							: ''}
					</span>
				</li>
			{/each}
		</ol>
	</section>
</div>
