<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { money } from '$lib/actions/money';
	import { ArrowUpRight, CircleHelp, Pencil, Trash2, Wallet } from '@lucide/svelte';
	import Money from '$lib/components/Money.svelte';
	import IncomeSchedule from '$lib/components/IncomeSchedule.svelte';
	import { calDateInZone } from '$lib/domain/time/zoned';
	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	let showNew = $state(false);
	// Today in the *workspace* timezone. toISOString() is UTC, so after ~8pm in
	// the Americas these forms defaulted to tomorrow's date.
	const today = $derived.by(() => {
		const t = calDateInZone(new Date(), data.workspace.timezone);
		return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
	});

	// New-entry schedule. `today` seeds the defaults and the user edits from
	// there; the page remounts per workspace so the snapshot can't go stale.
	let repeat = $state('once');
	// svelte-ignore state_referenced_locally
	let date = $state(today);
	let monthDay = $state('1');

	// Only one entry is open for editing at a time, so single slots suffice.
	let editing: string | null = $state(null);
	let editRepeatVal = $state('once');
	// svelte-ignore state_referenced_locally
	let editDate = $state(today);
	let editMonthDay = $state('1');

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function startEdit(e: (typeof data.entries)[number]) {
		editing = editing === e.id ? null : e.id;
		if (editing === null) return;
		editRepeatVal = e.freq === 'monthly' ? 'monthly' : 'once';
		editDate = e.receivedDate;
		editMonthDay = String(e.monthDay ?? 1);
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between px-1 pt-1">
		<h1 class="text-[28px]">Income</h1>
		<button
			onclick={() => (showNew = !showNew)}
			class="btn {showNew ? 'btn-ghost' : 'btn-tint'} px-4 py-2 text-[14px]"
		>
			{showNew ? 'Cancel' : 'Add income'}
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
			action="?/add"
			use:submit={{ success: 'Income added', onSuccess: () => (showNew = false) }}
			class="card space-y-3.5 p-5"
		>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<input name="source" required placeholder="Salary" class="field text-[16px]" />
				<input
					name="amount"
					required
					use:money
					inputmode="decimal"
					placeholder="3200.00"
					class="field w-32 text-[16px] tabular-nums"
				/>
			</div>
			<IncomeSchedule bind:repeat bind:date bind:monthDay />

			<button class="btn btn-accent w-full">Add income</button>
		</form>
	{/if}

	{#if data.entries.length === 0}
		<div class="card-lg card px-6 py-16 text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
				style="background: color-mix(in oklab, var(--approve) 16%, var(--surface-2))"
			>
				<Wallet class="h-7 w-7" style="color: var(--approve)" />
			</div>
			<p class="text-[18px] font-semibold" style="color: var(--ink)">No income yet</p>
			<p class="mx-auto mt-1 max-w-[30ch] text-[15px] leading-relaxed" style="color: var(--ink-3)">
				A budget without inflow can't tell you whether you're actually fine.
			</p>
			<a
				href="/w/{slug}/settings/help?s=income"
				class="press mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium"
				style="color: var(--ws-accent)"
			>
				<CircleHelp class="h-4 w-4" /> How this works
			</a>
		</div>
	{:else}
		<div class="card overflow-hidden">
			{#each data.entries as e, i (e.id)}
				<div class="px-4 py-3.5 {i < data.entries.length - 1 ? 'hairline' : ''}">
					<div class="flex items-center gap-3">
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
							style="background: color-mix(in oklab, var(--approve) 18%, transparent)"
						>
							<ArrowUpRight class="h-4 w-4" style="color: var(--approve)" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-[16px]" style="color: var(--ink)">{e.source}</p>
							<p class="text-[13px]" style="color: var(--ink-4)">
								{e.memberName} · {e.cadence ?? fmtDate(e.receivedAt)}
							</p>
						</div>
						<span style="color: var(--approve)">
							<Money
								minor={e.amountMinor}
								currency={e.currency}
								sign
								class="text-[16px] font-semibold"
							/>
						</span>
						{#if e.mine}
							<button
								onclick={() => startEdit(e)}
								class="press ml-1 inline-flex items-center gap-1"
								style="color: var(--ink-2)"
								aria-label="Edit"
							>
								<Pencil class="h-3.5 w-3.5" />
							</button>
							<form
								method="POST"
								action="?/remove"
								use:submit={{ confirm: 'Remove this income entry?', success: 'Income removed' }}
							>
								<input type="hidden" name="incomeId" value={e.id} />
								<button class="press ml-0.5" style="color: var(--ink-4)" aria-label="Remove">
									<Trash2 class="h-4 w-4" />
								</button>
							</form>
						{/if}
					</div>
					{#if editing === e.id}
						<form
							method="POST"
							action="?/edit"
							use:submit={{ success: 'Changes saved', onSuccess: () => (editing = null) }}
							class="mt-3 space-y-3 rounded-[14px] p-4"
							style="background: var(--surface-2)"
						>
							<input type="hidden" name="incomeId" value={e.id} />
							<div class="grid grid-cols-[1fr_auto] gap-3">
								<input name="source" required value={e.source} class="field text-[16px]" />
								<input
									name="amount"
									required
									use:money
									inputmode="decimal"
									value={(Number(e.amountMinor) / 100).toFixed(2)}
									class="field w-28 text-[16px] tabular-nums"
								/>
							</div>
							<IncomeSchedule
								bind:repeat={editRepeatVal}
								bind:date={editDate}
								bind:monthDay={editMonthDay}
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
				</div>
			{/each}
		</div>
	{/if}
</div>
