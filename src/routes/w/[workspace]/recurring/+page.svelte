<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import PlanTabs from '$lib/components/PlanTabs.svelte';
	import RecurrencePicker from '$lib/components/RecurrencePicker.svelte';
	import { calDateInZone } from '$lib/domain/time/zoned';
	import { money } from '$lib/actions/money';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import CheckField from '$lib/components/CheckField.svelte';
	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

	let freq = $state('monthly');
	let showNew = $state(false);
	let editing: string | null = $state(null);
	// Only one rule is open for editing at a time, so these are single slots
	// rather than a map keyed by rule id.
	let editFreq = $state('monthly');
	let editInterval = $state(1);
	let editWeekDays = $state<number[]>([]);
	let editMonthDay = $state('1');
	let editStart = $state('');
	// Bound straight into RecurrencePicker, which emits the same field names the
	// server already parses.
	let interval = $state(1);
	let weekDays = $state<number[]>([]);
	let monthDay = $state('1');
	// Today in the *workspace* timezone. toISOString() is UTC, so after ~8pm in
	// the Americas these forms defaulted to tomorrow's date.
	const today = $derived.by(() => {
		const t = calDateInZone(new Date(), data.workspace.timezone);
		return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
	});
	// Intentionally a snapshot: this seeds the field's default, and the user
	// edits it from there. The page remounts per workspace, so it can't go stale.
	// svelte-ignore state_referenced_locally
	let startDate = $state(today);
	let autoComplete = $state(true);
	let backfill = $state(false);
	let editAutoComplete = $state(true);

	function fmtStart(d: string): string {
		const [y, m, day] = d.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	function fmtNext(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function startEdit(r: (typeof data.rules)[number]) {
		editing = editing === r.id ? null : r.id;
		if (editing === null) return;
		editFreq = r.freq;
		editInterval = r.interval;
		editWeekDays = [...r.byDay];
		editMonthDay = String(r.monthDay ?? 1);
		editStart = r.startDate ?? today;
		editAutoComplete = r.autoComplete;
	}

	function resetNewForm() {
		showNew = false;
		freq = 'monthly';
		interval = 1;
		weekDays = [];
		monthDay = '1';
		startDate = today;
		autoComplete = true;
		backfill = false;
	}
</script>

<div class="space-y-4">
	<PlanTabs />
	<div class="flex items-center justify-between px-1">
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
			<RecurrencePicker bind:freq bind:interval bind:weekDays bind:monthDay bind:startDate />

			<select name="categoryId" class="field text-[16px]">
				<option value="">No category</option>
				{#each data.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
			</select>
			<!--
				Only *does* anything when the start date is behind us, but it stays on
				screen either way: hiding it meant you couldn't discover backfilling
				until you'd already backdated the start, and the form reflowed the
				moment you did. Disabled, it doubles as the instruction for enabling it.
				A disabled input isn't submitted, so a stale tick can't leak through.
			-->
			<CheckField
				name="backfill"
				bind:checked={backfill}
				disabled={startDate >= today}
				label="Add the charges I've already missed"
				hint={startDate < today
					? `Fills in every occurrence since ${fmtStart(startDate)}.`
					: 'Set the start date in the past to fill in charges you already missed.'}
			/>
			<CheckField
				name="autoComplete"
				bind:checked={autoComplete}
				label="It's the same amount every time"
				hint={autoComplete
					? 'Recorded for you on the day, at this amount.'
					: 'Each charge waits for you to enter what you were actually billed.'}
			/>
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
			<a
				href="/w/{slug}/settings/help?s=recurring"
				class="press mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium"
				style="color: var(--ws-accent)"
			>
				<Icon name="question" class="h-4 w-4" /> How this works
			</a>
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
							<form
								method="POST"
								action="?/edit"
								use:submit={{ success: 'Changes saved', onSuccess: () => (editing = null) }}
								class="mt-3 space-y-3 rounded-[14px] p-4"
								style="background: var(--surface-2)"
							>
								<input type="hidden" name="ruleId" value={r.id} />
								<div class="grid grid-cols-[1fr_auto] gap-3">
									<input name="itemName" required value={r.itemName} class="field text-[16px]" />
									<input
										name="amount"
										required
										use:money
										inputmode="decimal"
										value={(Number(r.amountMinor) / 100).toFixed(2)}
										class="field w-28 text-[16px] tabular-nums"
									/>
								</div>
								<RecurrencePicker
									bind:freq={editFreq}
									bind:interval={editInterval}
									bind:weekDays={editWeekDays}
									bind:monthDay={editMonthDay}
									bind:startDate={editStart}
								/>
								<select name="categoryId" class="field text-[16px]">
									<option value="">No category</option>
									{#each data.categories as c (c.id)}
										<option value={c.id} selected={c.id === r.categoryId}>{c.icon} {c.name}</option>
									{/each}
								</select>
								<CheckField
									name="autoComplete"
									bind:checked={editAutoComplete}
									label="It's the same amount every time"
									hint={editAutoComplete
										? 'Recorded for you on the day, at this amount.'
										: 'Each charge waits for you to enter what you were actually billed.'}
								/>
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
