<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();

	let showNew = $state(false);
	let repeat = $state('once');

	const today = new Date().toISOString().slice(0, 10);

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Income</h1>
		<button
			onclick={() => (showNew = !showNew)}
			class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
		>
			{showNew ? 'Close' : 'Add income'}
		</button>
	</div>

	{#if form?.error}
		<p
			class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
		>
			{form.error}
		</p>
	{/if}

	{#if showNew}
		<form
			method="POST"
			action="?/add"
			use:enhance
			class="space-y-3 rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900"
		>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Source</span>
					<input
						name="source"
						required
						placeholder="Salary"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">
						Amount ({data.workspace.currency})
					</span>
					<input
						name="amount"
						required
						inputmode="decimal"
						placeholder="3200.00"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Repeats</span>
					<select
						name="repeat"
						bind:value={repeat}
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					>
						<option value="once">One-off</option>
						<option value="monthly">Monthly</option>
					</select>
				</label>
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">
						{repeat === 'monthly' ? 'First payment' : 'Received on'}
					</span>
					<input
						name="date"
						type="date"
						value={today}
						required
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
			</div>
			{#if repeat === 'monthly'}
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Day of month</span>
					<select
						name="monthDay"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					>
						{#each Array.from({ length: 28 }, (_, i) => i + 1) as day (day)}
							<option value={day}>{day}</option>
						{/each}
						<option value="-1">Last day</option>
					</select>
				</label>
			{/if}
			<button
				class="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
			>
				Add
			</button>
		</form>
	{/if}

	{#if data.entries.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-neutral-900">
			<p class="text-3xl">💰</p>
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				No income yet. A budget without inflow can't tell you if you're actually fine.
			</p>
		</div>
	{:else}
		<ul
			class="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm dark:divide-neutral-800 dark:bg-neutral-900"
		>
			{#each data.entries as e (e.id)}
				<li class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="min-w-0">
						<p class="truncate font-medium text-neutral-900 dark:text-neutral-50">{e.source}</p>
						<p class="text-sm text-neutral-500 dark:text-neutral-400">
							{e.memberName} · {e.cadence ?? fmtDate(e.receivedAt)}
						</p>
					</div>
					<div class="flex items-center gap-3">
						<span class="font-medium text-green-700 tabular-nums dark:text-green-400">
							+{formatMinor(e.amountMinor, e.currency)}
						</span>
						{#if e.mine}
							<form method="POST" action="?/remove" use:enhance>
								<input type="hidden" name="incomeId" value={e.id} />
								<button class="text-xs text-neutral-300 hover:text-red-600" aria-label="Remove"
									>✕</button
								>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
