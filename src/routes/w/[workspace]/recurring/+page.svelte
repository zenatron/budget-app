<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();

	let freq = $state('monthly');
	let showNew = $state(false);
	let editingPrice: string | null = $state(null);

	const today = new Date().toISOString().slice(0, 10);
	const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	function fmtNext(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Recurring</h1>
		<button
			onclick={() => (showNew = !showNew)}
			class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
		>
			{showNew ? 'Close' : 'New rule'}
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
			action="?/create"
			use:enhance
			class="space-y-3 rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900"
		>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Item</span>
					<input
						name="itemName"
						required
						placeholder="Streaming service"
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
						placeholder="9.99"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Repeats</span>
					<select
						name="freq"
						bind:value={freq}
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					>
						<option value="daily">Daily</option>
						<option value="weekly">Weekly</option>
						<option value="monthly">Monthly</option>
						<option value="yearly">Yearly</option>
					</select>
				</label>
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Every</span>
					<input
						name="interval"
						type="number"
						min="1"
						max="52"
						value="1"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Starting</span>
					<input
						name="startDate"
						type="date"
						value={today}
						required
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
			</div>

			{#if freq === 'weekly'}
				<fieldset>
					<legend class="text-sm text-neutral-600 dark:text-neutral-400">On</legend>
					<div class="mt-1 flex flex-wrap gap-3">
						{#each dayNames as name, i (name)}
							<label class="flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-300">
								<input
									type="checkbox"
									name="weekDay"
									value={i + 1}
									class="rounded border-neutral-300 dark:border-neutral-600"
								/>
								{name}
							</label>
						{/each}
					</div>
				</fieldset>
			{:else if freq === 'monthly' || freq === 'yearly'}
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

			<label class="block">
				<span class="text-sm text-neutral-600 dark:text-neutral-400">Category</span>
				<select
					name="categoryId"
					class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				>
					<option value="">None</option>
					{#each data.categories as c (c.id)}
						<option value={c.id}>{c.icon} {c.name}</option>
					{/each}
				</select>
			</label>

			<label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
				<input
					type="checkbox"
					name="autoComplete"
					checked
					class="rounded border-neutral-300 dark:border-neutral-600"
				/>
				Record automatically (fixed price — no confirmation needed)
			</label>

			<button
				class="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
			>
				Create rule
			</button>
		</form>
	{/if}

	{#if data.rules.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-neutral-900">
			<p class="text-3xl">🔁</p>
			<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
				No recurring charges yet — rent, subscriptions, utilities.
			</p>
		</div>
	{:else}
		<ul
			class="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm dark:divide-neutral-800 dark:bg-neutral-900"
		>
			{#each data.rules as r (r.id)}
				<li class="px-4 py-3">
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate font-medium text-neutral-900 dark:text-neutral-50">
								{r.itemName}{r.status === 'paused' ? ' · paused' : ''}
							</p>
							<p class="text-sm text-neutral-500 dark:text-neutral-400">
								{r.cadence} · next {fmtNext(r.nextAt)}{r.autoComplete ? '' : ' · needs confirming'}
							</p>
						</div>
						<span class="font-medium text-neutral-900 tabular-nums dark:text-neutral-50">
							{formatMinor(r.amountMinor, r.currency)}
						</span>
					</div>
					{#if r.mine}
						<div class="mt-2 flex items-center gap-4 text-sm">
							{#if r.status === 'active'}
								<form method="POST" action="?/pause" use:enhance>
									<input type="hidden" name="ruleId" value={r.id} />
									<button class="text-neutral-400 hover:text-neutral-600">Pause</button>
								</form>
							{:else}
								<form method="POST" action="?/resume" use:enhance>
									<input type="hidden" name="ruleId" value={r.id} />
									<button class="text-neutral-400 hover:text-neutral-600">Resume</button>
								</form>
							{/if}
							<button
								onclick={() => (editingPrice = editingPrice === r.id ? null : r.id)}
								class="text-neutral-400 hover:text-neutral-600"
							>
								Price
							</button>
							<form method="POST" action="?/end" use:enhance>
								<input type="hidden" name="ruleId" value={r.id} />
								<button class="text-neutral-400 hover:text-red-600">End</button>
							</form>
						</div>
						{#if editingPrice === r.id}
							<form method="POST" action="?/price" use:enhance class="mt-2 flex items-center gap-2">
								<input type="hidden" name="ruleId" value={r.id} />
								<input
									name="amount"
									inputmode="decimal"
									placeholder="New amount"
									class="w-32 rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
								/>
								<button
									class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-50 dark:text-neutral-900"
								>
									Update
								</button>
								<span class="text-xs text-neutral-400">Applies to future charges</span>
							</form>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
