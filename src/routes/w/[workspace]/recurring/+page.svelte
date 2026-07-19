<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { money } from '$lib/actions/money';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	let { data, form } = $props();

	let freq = $state('monthly');
	let showNew = $state(false);
	let editing: string | null = $state(null);
	let editFreq: Record<string, string> = $state({});
	let patternInput = $state('');
	// The pattern box writes into these; the fields below are bound to them.
	// Reaching for the DOM instead meant the parsed value and the component's
	// idea of the form disagreed the moment either one changed.
	let interval = $state(1);
	let weekDays = $state<number[]>([]);
	let monthDay = $state('1');
	const today = new Date().toISOString().slice(0, 10);
	const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	function fmtNext(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function editFreqFor(r: (typeof data.rules)[number]): string {
		return editFreq[r.id] ?? r.freq;
	}

	function startEdit(r: (typeof data.rules)[number]) {
		editing = editing === r.id ? null : r.id;
		editFreq = { ...editFreq, [r.id]: r.freq };
	}

	function parsePattern(text: string) {
		const t = text.toLowerCase().trim();
		if (!t) return;
		if (/\b(every\s+)?day\b/.test(t) || /\bdaily\b/.test(t)) freq = 'daily';
		else if (/\b(every\s+)?week\b/.test(t) || /\bweekly\b/.test(t)) freq = 'weekly';
		else if (/\b(every\s+)?month\b/.test(t) || /\bmonthly\b/.test(t)) freq = 'monthly';
		else if (/\b(every\s+)?year\b/.test(t) || /\byearly\b/.test(t)) freq = 'yearly';

		const intervalMatch = t.match(/every\s+(\d+)/);
		if (intervalMatch) {
			const intv = parseInt(intervalMatch[1]);
			if (intv >= 1 && intv <= 52) interval = intv;
		}

		const foundDays: number[] = [];
		const dayMap: Record<string, number> = {
			sun: 7,
			mon: 1,
			tue: 2,
			wed: 3,
			thu: 4,
			fri: 5,
			sat: 6
		};
		for (const [name, idx] of Object.entries(dayMap)) {
			if (t.includes(name)) foundDays.push(idx);
		}
		if (foundDays.length > 0) weekDays = foundDays;

		const monthDayMatch = t.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
		if (monthDayMatch && (freq === 'monthly' || freq === 'yearly')) {
			const day = parseInt(monthDayMatch[1]);
			if (day >= 1 && day <= 28) monthDay = String(day);
		}
		if (/\blast\s+day\b/.test(t)) monthDay = '-1';
	}

	function resetNewForm() {
		showNew = false;
		patternInput = '';
		freq = 'monthly';
		interval = 1;
		weekDays = [];
		monthDay = '1';
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between px-1 pt-1">
		<h1 class="text-[28px]">Recurring</h1>
		<button
			onclick={() => (showNew = !showNew)}
			class="btn {showNew ? 'btn-ghost' : 'btn-tint'} px-4 py-2 text-[14px]"
		>
			{showNew ? 'Cancel' : '+ New'}
		</button>
	</div>

	{#if form?.error}
		<div
			class="card p-4 text-[15px]"
			style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
		>
			{form.error}
		</div>
	{/if}

	{#if showNew}
		<form
			method="POST"
			action="?/create"
			use:submit={{ success: 'Recurring charge added', onSuccess: resetNewForm }}
			class="card space-y-3.5 p-5"
		>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<input name="itemName" required placeholder="Streaming service" class="field text-[16px]" />
				<input
					name="amount"
					required
					use:money
					inputmode="decimal"
					placeholder="9.99"
					class="field w-28 text-[16px] tabular-nums"
				/>
			</div>
			<div class="relative">
				<input
					name="pattern"
					bind:value={patternInput}
					oninput={() => parsePattern(patternInput)}
					placeholder="e.g. every month on the 1st, or every 2 weeks on Mon and Thu"
					class="field pr-8 text-[15px]"
				/>
				<span
					class="absolute top-1/2 right-3 -translate-y-1/2 text-[12px]"
					style="color: var(--ink-4)">?</span
				>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<select name="freq" bind:value={freq} class="field text-[15px]">
					<option value="daily">Daily</option>
					<option value="weekly">Weekly</option>
					<option value="monthly">Monthly</option>
					<option value="yearly">Yearly</option>
				</select>
				<input
					name="interval"
					type="number"
					min="1"
					max="52"
					bind:value={interval}
					class="field text-[15px] tabular-nums"
				/>
				<input name="startDate" type="date" value={today} required class="field text-[15px]" />
			</div>
			{#if freq === 'weekly'}
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					{#each dayNames as name, i (name)}
						<label class="flex items-center gap-1.5 text-[15px]" style="color: var(--ink)">
							<input
								type="checkbox"
								name="weekDay"
								value={i + 1}
								bind:group={weekDays}
								class="rounded"
							/>
							{name}
						</label>
					{/each}
				</div>
			{:else if freq === 'monthly' || freq === 'yearly'}
				<select name="monthDay" bind:value={monthDay} class="field text-[15px]">
					{#each Array.from({ length: 28 }, (_, i) => i + 1) as d (d)}<option value={String(d)}
							>Day {d}</option
						>{/each}
					<option value="-1">Last day</option>
				</select>
			{/if}
			<select name="categoryId" class="field text-[15px]">
				<option value="">No category</option>
				{#each data.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
			</select>
			<label class="flex items-center gap-2 text-[15px]" style="color: var(--ink-2)">
				<input type="checkbox" name="autoComplete" checked class="rounded" /> Record automatically
			</label>
			<button class="btn btn-accent w-full">Add recurring charge</button>
		</form>
	{/if}

	{#if data.rules.length === 0}
		<div class="card-lg card px-6 py-16 text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
				style="background: color-mix(in oklab, var(--ws-accent) 16%, var(--surface-2))"
			>
				<Icon name="repeat" class="h-7 w-7" style="color: var(--ws-accent)" />
			</div>
			<p class="text-[18px] font-semibold" style="color: var(--ink)">No recurring charges</p>
			<p class="mx-auto mt-1 max-w-[28ch] text-[15px] leading-relaxed" style="color: var(--ink-3)">
				Add subscriptions, bills, and rent so they track themselves.
			</p>
		</div>
	{:else}
		<div class="card overflow-hidden">
			{#each data.rules as r, i (r.id)}
				<div class="px-4 py-3.5 {i < data.rules.length - 1 ? 'hairline' : ''}">
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="flex items-center gap-1.5 text-[16px]" style="color: var(--ink)">
								{r.itemName}
								{#if r.status === 'paused'}
									<span class="chip" style="color: var(--ink-3); background: var(--surface-2)"
										>Paused</span
									>
								{/if}
							</p>
							<p class="mt-0.5 text-[13px]" style="color: var(--ink-4)">
								{r.cadence} · next {fmtNext(r.nextAt)}{r.autoComplete ? '' : ' · needs confirming'}
							</p>
						</div>
						<Money
							minor={r.amountMinor}
							currency={r.currency}
							class="shrink-0 text-[16px] font-semibold"
						/>
					</div>
					{#if r.mine}
						<div class="mt-2.5 flex items-center gap-4 text-[13px]">
							{#if r.status === 'active'}
								<form method="POST" action="?/pause" use:submit={{ success: 'Paused' }}>
									<input type="hidden" name="ruleId" value={r.id} />
									<button class="press inline-flex items-center gap-1" style="color: var(--ink-3)">
										<Icon name="pause" class="h-3.5 w-3.5" /> Pause
									</button>
								</form>
							{:else}
								<form method="POST" action="?/resume" use:submit={{ success: 'Resumed' }}>
									<input type="hidden" name="ruleId" value={r.id} />
									<button
										class="press inline-flex items-center gap-1"
										style="color: var(--approve)"
									>
										<Icon name="play" class="h-3.5 w-3.5" /> Resume
									</button>
								</form>
							{/if}
							<button
								onclick={() => startEdit(r)}
								class="press inline-flex items-center gap-1"
								style="color: var(--ink-2)"
							>
								<Icon name="pencil" class="h-3.5 w-3.5" /> Edit
							</button>
							<form
								method="POST"
								action="?/end"
								use:submit={{
									confirm: 'End this recurring charge? It stops generating new purchases.',
									success: 'Recurring charge ended'
								}}
								class="ml-auto"
							>
								<input type="hidden" name="ruleId" value={r.id} />
								<button class="press" style="color: color-mix(in oklab, var(--deny) 80%, white)"
									>End</button
								>
							</form>
						</div>
						{#if editing === r.id}
							{@const f = editFreqFor(r)}
							<form
								method="POST"
								action="?/edit"
								use:submit={{ success: 'Changes saved', onSuccess: () => (editing = null) }}
								class="mt-3 space-y-3 rounded-[14px] p-4"
								style="background: var(--surface-2)"
							>
								<input type="hidden" name="ruleId" value={r.id} />
								<div class="grid grid-cols-[1fr_auto] gap-3">
									<input name="itemName" required value={r.itemName} class="field text-[15px]" />
									<input
										name="amount"
										required
										use:money
										inputmode="decimal"
										value={(Number(r.amountMinor) / 100).toFixed(2)}
										class="field w-28 text-[15px] tabular-nums"
									/>
								</div>
								<div class="grid grid-cols-3 gap-3">
									<select
										name="freq"
										value={f}
										onchange={(e) => {
											editFreq = {
												...editFreq,
												[r.id]: (e.currentTarget as HTMLSelectElement).value
											};
										}}
										class="field text-[15px]"
									>
										<option value="daily">Daily</option>
										<option value="weekly">Weekly</option>
										<option value="monthly">Monthly</option>
										<option value="yearly">Yearly</option>
									</select>
									<input
										name="interval"
										type="number"
										min="1"
										max="52"
										value={r.interval}
										class="field text-[15px] tabular-nums"
									/>
									<input
										name="startDate"
										type="date"
										value={today}
										required
										class="field text-[15px]"
									/>
								</div>
								{#if f === 'weekly'}
									<div class="flex flex-wrap gap-x-4 gap-y-2">
										{#each dayNames as name, idx (name)}
											<label
												class="flex items-center gap-1.5 text-[15px]"
												style="color: var(--ink)"
											>
												<input
													type="checkbox"
													name="weekDay"
													value={idx + 1}
													checked={r.byDay.includes(idx + 1)}
													class="rounded"
												/>
												{name}
											</label>
										{/each}
									</div>
								{:else if f === 'monthly' || f === 'yearly'}
									<select name="monthDay" bind:value={monthDay} class="field text-[15px]">
										{#each Array.from({ length: 28 }, (_, i) => i + 1) as d (d)}
											<option value={d} selected={r.monthDay === d}>Day {d}</option>
										{/each}
										<option value="-1" selected={r.monthDay === -1}>Last day</option>
									</select>
								{/if}
								<select name="categoryId" class="field text-[15px]">
									<option value="">No category</option>
									{#each data.categories as c (c.id)}
										<option value={c.id} selected={c.id === r.categoryId}>{c.icon} {c.name}</option>
									{/each}
								</select>
								<label class="flex items-center gap-2 text-[15px]" style="color: var(--ink-2)">
									<input
										type="checkbox"
										name="autoComplete"
										checked={r.autoComplete}
										class="rounded"
									/> Record automatically
								</label>
								<div class="flex gap-2">
									<button class="btn btn-accent flex-1 py-2.5 text-[14px]">Save changes</button>
									<button
										type="button"
										onclick={() => (editing = null)}
										class="btn btn-ghost flex-1 py-2.5 text-[14px]">Cancel</button
									>
								</div>
							</form>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
