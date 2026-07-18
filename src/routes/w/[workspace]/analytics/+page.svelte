<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();

	let showBudgetForm = $state(false);

	const currency = $derived(data.workspace.currency);
	const maxCategory = $derived(
		data.categories.reduce((max, c) => (c.totalMinor > max ? c.totalMinor : max), 1n)
	);
	const maxDay = $derived(
		data.days.reduce((max, d) => (d.totalMinor > max ? d.totalMinor : max), 1n)
	);

	const comparison = $derived.by(() => {
		if (data.prevTotalMinor === 0n) return data.totalMinor > 0n ? 'nothing spent last month' : null;
		const pctX10 = (data.totalMinor * 1000n) / data.prevTotalMinor;
		const pct = Number(pctX10) / 10;
		if (pct > 100) return `${(pct - 100).toFixed(0)}% more than last month`;
		if (pct < 100) return `${(100 - pct).toFixed(0)}% less than last month`;
		return 'same as last month';
	});

	function pctOf(part: bigint, whole: bigint): number {
		if (whole === 0n) return 0;
		return Math.min(100, Number((part * 1000n) / whole) / 10);
	}
</script>

<div class="space-y-6">
	<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Analytics</h1>

	<section class="rounded-2xl bg-white p-6 shadow-sm dark:bg-neutral-900">
		<p class="text-sm text-neutral-500 dark:text-neutral-400">{data.monthLabel}</p>
		<p class="mt-1 text-3xl font-semibold text-neutral-900 tabular-nums dark:text-neutral-50">
			{formatMinor(data.totalMinor, currency)}
		</p>
		{#if comparison}
			<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
				{comparison} ({formatMinor(data.prevTotalMinor, currency)})
			</p>
		{/if}

		<!-- daily bars, hand-built SVG -->
		<svg viewBox="0 0 {data.days.length * 8} 48" class="mt-4 h-12 w-full" aria-hidden="true">
			{#each data.days as d, i (i)}
				{@const h = Number((d.totalMinor * 44n) / maxDay)}
				<rect
					x={i * 8 + 1}
					y={46 - h}
					width="6"
					height={Math.max(h, d.totalMinor > 0n ? 2 : 0)}
					rx="1.5"
					class={d.day <= data.todayDay
						? 'fill-neutral-800 dark:fill-neutral-200'
						: 'fill-neutral-200 dark:fill-neutral-700'}
				/>
			{/each}
		</svg>
	</section>

	{#if data.incomeMinor > 0n}
		{@const net = data.incomeMinor - data.totalMinor}
		{@const savingsPct =
			Number(((data.incomeMinor - data.totalMinor) * 1000n) / data.incomeMinor) / 10}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Net position</h2>
			<div class="mt-2 grid grid-cols-3 gap-3 text-center">
				<div>
					<p class="text-xs text-neutral-400">In</p>
					<p class="font-medium text-green-700 tabular-nums dark:text-green-400">
						{formatMinor(data.incomeMinor, currency)}
					</p>
				</div>
				<div>
					<p class="text-xs text-neutral-400">Out</p>
					<p class="font-medium text-neutral-900 tabular-nums dark:text-neutral-50">
						{formatMinor(data.totalMinor, currency)}
					</p>
				</div>
				<div>
					<p class="text-xs text-neutral-400">Net</p>
					<p
						class="font-medium tabular-nums {net < 0n
							? 'text-red-600 dark:text-red-400'
							: 'text-green-700 dark:text-green-400'}"
					>
						{net < 0n ? '−' : '+'}{formatMinor(net < 0n ? -net : net, currency)}
					</p>
				</div>
			</div>
			<p class="mt-2 text-center text-sm text-neutral-500 dark:text-neutral-400">
				{savingsPct >= 0
					? `Saving ${savingsPct.toFixed(0)}% of income`
					: 'Spending more than comes in'}
			</p>
		</section>
	{/if}

	{#if data.budgets.length > 0 || data.isOwner}
		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Budgets</h2>
				{#if data.isOwner}
					<button
						onclick={() => (showBudgetForm = !showBudgetForm)}
						class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
					>
						{showBudgetForm ? 'Close' : 'Set budget'}
					</button>
				{/if}
			</div>

			{#if showBudgetForm}
				<form method="POST" action="?/setBudget" use:enhance class="mt-3 flex items-end gap-2">
					<label class="flex-1">
						<span class="text-xs text-neutral-500 dark:text-neutral-400">Scope</span>
						<select
							name="categoryId"
							class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						>
							<option value="">Everything</option>
							{#each data.allCategories as c (c.id)}
								<option value={c.id}>{c.icon} {c.name}</option>
							{/each}
						</select>
					</label>
					<label class="w-28">
						<span class="text-xs text-neutral-500 dark:text-neutral-400">
							Monthly ({currency})
						</span>
						<input
							name="amount"
							inputmode="decimal"
							placeholder="500"
							class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						/>
					</label>
					<button
						class="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-neutral-50 dark:text-neutral-900"
					>
						Save
					</button>
				</form>
				{#if form?.error}
					<p class="mt-2 text-sm text-red-600 dark:text-red-400">{form.error}</p>
				{/if}
			{/if}

			{#if data.budgets.length === 0}
				<p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">No budgets yet.</p>
			{:else}
				<ul class="mt-3 space-y-3">
					{#each data.budgets as b (b.budgetId)}
						{@const pct = pctOf(b.actualMinor, b.budgetMinor)}
						{@const over = b.actualMinor > b.budgetMinor}
						<li>
							<div class="flex items-baseline justify-between text-sm">
								<span class="text-neutral-700 dark:text-neutral-300">
									{b.categoryIcon ?? ''}
									{b.categoryName}
								</span>
								<span
									class="tabular-nums {over
										? 'font-medium text-red-600 dark:text-red-400'
										: 'text-neutral-500 dark:text-neutral-400'}"
								>
									{formatMinor(b.actualMinor, currency)} / {formatMinor(b.budgetMinor, currency)}
								</span>
							</div>
							<div class="mt-1 flex items-center gap-2">
								<div
									class="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
								>
									<div
										class="h-full rounded-full {over ? 'bg-red-500' : 'bg-green-500'}"
										style="width: {pct}%"
									></div>
								</div>
								{#if data.isOwner}
									<form method="POST" action="?/deleteBudget" use:enhance>
										<input type="hidden" name="budgetId" value={b.budgetId} />
										<button
											class="text-xs text-neutral-300 hover:text-red-600"
											aria-label="Remove budget">✕</button
										>
									</form>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">By category</h2>
		{#if data.categories.length === 0}
			<p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">Nothing this month yet.</p>
		{:else}
			<ul class="mt-3 space-y-3">
				{#each data.categories as c (c.categoryId ?? 'none')}
					<li>
						<div class="flex items-baseline justify-between text-sm">
							<span class="text-neutral-700 dark:text-neutral-300">{c.icon ?? '•'} {c.name}</span>
							<span class="text-neutral-900 tabular-nums dark:text-neutral-50">
								{formatMinor(c.totalMinor, currency)}
							</span>
						</div>
						<div class="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
							<div
								class="h-full rounded-full"
								style="width: {pctOf(c.totalMinor, maxCategory)}%; background-color: {c.color ??
									'#a3a3a3'}"
							></div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
		<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">By member</h2>
		{#if data.members.length === 0}
			<p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">Nothing this month yet.</p>
		{:else}
			<ul class="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
				{#each data.members as m (m.memberId)}
					<li class="flex items-center justify-between py-2.5">
						<span class="text-neutral-700 dark:text-neutral-300">{m.name}</span>
						<span class="font-medium text-neutral-900 tabular-nums dark:text-neutral-50">
							{formatMinor(m.totalMinor, currency)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
