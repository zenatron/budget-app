<script lang="ts">
	import { enhance } from '$app/forms';
	import { money } from '$lib/actions/money';
	import { formatMinor } from '$lib/money-format';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';

	let { data, form } = $props();

	const accents = [
		'#FF9F0A',
		'#FF375F',
		'#30D158',
		'#0A84FF',
		'#BF5AF2',
		'#FF453A',
		'#40C8E0',
		'#FFD60A'
	];

	let showNew = $state(false);
	let createColor = $state<string | null>(null);
	let editing: string | null = $state(null);
	let editColor: Record<string, string | null> = $state({});
	let adjusting: string | null = $state(null);

	function colorFor(b: (typeof data.buckets)[number]): string {
		return b.color ?? 'var(--ws-accent)';
	}

	function progressPct(b: (typeof data.buckets)[number]): number {
		if (!b.goalCapMinor || b.goalCapMinor <= 0n) return 0;
		const pct = Math.round((Number(b.balanceMinor) / Number(b.goalCapMinor)) * 100);
		return Math.max(0, Math.min(100, pct));
	}

	function formatMonthly(amountMinor: bigint, currency: string, dayOfMonth: number): string {
		const suffix =
			dayOfMonth === 1 || dayOfMonth === 21 || dayOfMonth === 31
				? 'st'
				: dayOfMonth === 2 || dayOfMonth === 22
					? 'nd'
					: dayOfMonth === 3 || dayOfMonth === 23
						? 'rd'
						: 'th';
		return `+${formatMinor(amountMinor, currency)}/mo on the ${dayOfMonth}${suffix}`;
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between px-1 pt-1">
		<h1 class="text-[28px]">Buckets</h1>
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
			use:enhance={() => {
				return async ({ update, result }) => {
					await update();
					if (result.type === 'success') {
						showNew = false;
						createColor = null;
					}
				};
			}}
			class="card space-y-3.5 p-5"
		>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<input name="name" required placeholder="Travel fund" class="field text-[16px]" />
				<input
					name="amount"
					required
					use:money
					inputmode="decimal"
					placeholder="500.00"
					class="field w-28 text-[16px] tabular-nums"
				/>
			</div>
			<div class="flex items-center gap-2">
				<label class="shrink-0 text-[14px]" style="color: var(--ink-3)" for="createDayOfMonth"
					>Accrues on day</label
				>
				<select id="createDayOfMonth" name="dayOfMonth" class="field text-[16px]">
					{#each Array.from({ length: 28 }, (_, i) => i + 1) as d}
						<option value={d}>{d}</option>
					{/each}
				</select>
			</div>
			<input
				name="goalCap"
				use:money
				inputmode="decimal"
				placeholder="Save up to…"
				class="field text-[16px]"
			/>
			<p class="text-[11px] font-medium tracking-[0.14em] uppercase" style="color: var(--ink-4)">
				Color
			</p>
			<div class="flex gap-2.5">
				{#each accents as c (c)}
					<button
						type="button"
						onclick={() => (createColor = createColor === c ? null : c)}
						class="press flex h-8 w-8 items-center justify-center rounded-full"
						style="background: {c}; box-shadow: {createColor === c
							? `0 0 0 2.5px var(--ink)`
							: `0 0 0 0px transparent`}"
						aria-label="Color {c}"
					></button>
				{/each}
			</div>
			<input type="hidden" name="color" value={createColor ?? ''} />
			<button class="btn btn-accent w-full">Create bucket</button>
		</form>
	{/if}

	{#if data.buckets.length === 0}
		<div class="card-lg card px-6 py-16 text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
				style="background: color-mix(in oklab, var(--ws-accent) 16%, var(--surface-2))"
			>
				<Icon name="wallet" class="h-7 w-7" style="color: var(--ws-accent)" />
			</div>
			<p class="text-[18px] font-semibold" style="color: var(--ink)">No buckets yet</p>
			<p class="mx-auto mt-1 max-w-[30ch] text-[15px] leading-relaxed" style="color: var(--ink-3)">
				Create virtual savings envelopes for goals, trips, and rainy days.
			</p>
		</div>
	{:else}
		<div class="card overflow-hidden">
			{#each data.buckets as b, i (b.id)}
				<div class="px-4 py-3.5 {i < data.buckets.length - 1 ? 'hairline' : ''}">
					<div class="flex items-center gap-3">
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
							style="background: color-mix(in oklab, {colorFor(b)} 20%, transparent)"
						>
							<div class="h-4 w-4 rounded-full" style="background: {colorFor(b)}"></div>
						</div>
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-1.5 text-[16px]" style="color: var(--ink)">
								{b.name}
								{#if b.status === 'paused'}
									<span class="chip" style="color: var(--ink-3); background: var(--surface-2)"
										>Paused</span
									>
								{/if}
							</p>
							<p class="text-[13px]" style="color: var(--ink-4)">
								{formatMonthly(b.monthlyAmountMinor, b.currency, b.dayOfMonth)}
							</p>
						</div>
						<span class="shrink-0 text-[16px] font-semibold" style="color: var(--ink)">
							<Money
								minor={b.balanceMinor}
								currency={b.currency}
								class="text-[16px] font-semibold"
							/>
						</span>
					</div>

					{#if b.goalCapMinor && b.goalCapMinor > 0n}
						<div
							class="mt-2 h-1.5 overflow-hidden rounded-full"
							style="background: var(--surface-2)"
						>
							<div
								class="h-full rounded-full transition-all"
								style="width: {progressPct(b)}%; background: {colorFor(b)}"
							></div>
						</div>
						<div class="mt-1 flex justify-between text-[11px]" style="color: var(--ink-4)">
							<span>{progressPct(b)}% of {formatMinor(b.goalCapMinor, b.currency)}</span>
							<span>{b.memberName}</span>
						</div>
					{/if}

					{#if b.mine}
						<div class="mt-2.5 flex items-center gap-4 text-[13px]">
							<button
								onclick={() => {
									editing = editing === b.id ? null : b.id;
									editColor = { ...editColor, [b.id]: b.color };
								}}
								class="press inline-flex items-center gap-1"
								style="color: var(--ink-2)"
							>
								<Icon name="pencil" class="h-3.5 w-3.5" /> Edit
							</button>
							{#if b.status === 'active'}
								<form method="POST" action="?/pause" use:enhance>
									<input type="hidden" name="bucketId" value={b.id} />
									<button class="press inline-flex items-center gap-1" style="color: var(--ink-3)">
										<Icon name="pause" class="h-3.5 w-3.5" /> Pause
									</button>
								</form>
							{:else}
								<form method="POST" action="?/resume" use:enhance>
									<input type="hidden" name="bucketId" value={b.id} />
									<button
										class="press inline-flex items-center gap-1"
										style="color: var(--approve)"
									>
										<Icon name="play" class="h-3.5 w-3.5" /> Resume
									</button>
								</form>
							{/if}
							<button
								onclick={() => (adjusting = adjusting === b.id ? null : b.id)}
								class="press inline-flex items-center gap-1"
								style="color: var(--ink-2)"
							>
								<Icon name="plus" class="h-3.5 w-3.5" /> Adjust
							</button>
							<form method="POST" action="?/archive" use:enhance class="ml-auto">
								<input type="hidden" name="bucketId" value={b.id} />
								<button class="press" style="color: color-mix(in oklab, var(--deny) 80%, white)"
									>Archive</button
								>
							</form>
						</div>

						{#if editing === b.id}
							{@const ec = editColor[b.id]}
							<form
								method="POST"
								action="?/edit"
								use:enhance={() => {
									return async ({ update, result }) => {
										await update();
										if (result.type === 'success') editing = null;
									};
								}}
								class="mt-3 space-y-3 rounded-[14px] p-4"
								style="background: var(--surface-2)"
							>
								<input type="hidden" name="bucketId" value={b.id} />
								<div class="grid grid-cols-[1fr_auto] gap-3">
									<input name="name" required value={b.name} class="field text-[15px]" />
									<input
										name="amount"
										required
										use:money
										inputmode="decimal"
										value={(Number(b.monthlyAmountMinor) / 100).toFixed(2)}
										class="field w-28 text-[15px] tabular-nums"
									/>
								</div>
								<div class="flex items-center gap-2">
									<label
										class="shrink-0 text-[13px]"
										style="color: var(--ink-3)"
										for="editDayOfMonth-{b.id}">Accrues on day</label
									>
									<select id="editDayOfMonth-{b.id}" name="dayOfMonth" class="field text-[15px]">
										{#each Array.from({ length: 28 }, (_, i) => i + 1) as d}
											<option value={d} selected={d === b.dayOfMonth}>{d}</option>
										{/each}
									</select>
								</div>
								<input
									name="goalCap"
									use:money
									inputmode="decimal"
									value={b.goalCapMinor !== null ? (Number(b.goalCapMinor) / 100).toFixed(2) : ''}
									placeholder="Save up to…"
									class="field text-[15px]"
								/>
								<p
									class="text-[11px] font-medium tracking-[0.14em] uppercase"
									style="color: var(--ink-4)"
								>
									Color
								</p>
								<div class="flex gap-2.5">
									{#each accents as c (c)}
										<button
											type="button"
											onclick={() => {
												editColor = { ...editColor, [b.id]: ec === c ? null : c };
											}}
											class="press flex h-8 w-8 items-center justify-center rounded-full"
											style="background: {c}; box-shadow: {ec === c
												? `0 0 0 2.5px var(--ink)`
												: `0 0 0 0px transparent`}"
											aria-label="Color {c}"
										></button>
									{/each}
								</div>
								<input type="hidden" name="color" value={ec ?? ''} />
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

						{#if adjusting === b.id}
							<form
								method="POST"
								action="?/adjust"
								use:enhance={() => {
									return async ({ update, result }) => {
										await update();
										if (result.type === 'success') adjusting = null;
									};
								}}
								class="mt-3 space-y-3 rounded-[14px] p-4"
								style="background: var(--surface-2)"
							>
								<input type="hidden" name="bucketId" value={b.id} />
								<div class="grid grid-cols-[1fr_auto] gap-3">
									<input
										name="amount"
										required
										use:money
										inputmode="decimal"
										placeholder={b.status === 'active' ? '50.00' : '500.00'}
										class="field text-[15px]"
									/>
									<select name="type" class="field text-[15px]">
										<option value="withdrawal">Take money out</option>
										<option value="adjustment">Add money</option>
									</select>
								</div>
								<input name="note" placeholder="Optional note" class="field text-[15px]" />
								<div class="flex gap-2">
									<button class="btn btn-accent flex-1 py-2.5 text-[14px]">
										Save adjustment
									</button>
									<button
										type="button"
										onclick={() => (adjusting = null)}
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
