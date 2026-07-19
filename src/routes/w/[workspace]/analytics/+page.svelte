<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { goto } from '$app/navigation';
	import { money } from '$lib/actions/money';
	import { formatMinor } from '$lib/money-format';
	import { formatPct } from '$lib/format';
	import Money from '$lib/components/Money.svelte';
	import CategoryRing from '$lib/components/CategoryRing.svelte';
	let { data } = $props();
	let showBudgetForm = $state(false);
	const currency = $derived(data.workspace.currency);
	const period = $derived(data.period);
	const isMonth = $derived(period === 'month');

	let touchStartX = $state(0);
	let touchStartY = $state(0);
	let swiping = $state(false);
	let swipeOffset = $state(0);

	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		swiping = true;
	}

	function onTouchMove(e: TouchEvent) {
		if (!swiping) return;
		const dx = e.touches[0].clientX - touchStartX;
		const dy = e.touches[0].clientY - touchStartY;
		if (Math.abs(dy) > Math.abs(dx)) {
			swiping = false;
			return;
		}
		swipeOffset = dx;
	}

	function onTouchEnd(e: TouchEvent) {
		if (!swiping) {
			swipeOffset = 0;
			return;
		}
		swiping = false;
		const dx = e.changedTouches[0].clientX - touchStartX;
		swipeOffset = 0;
		if (Math.abs(dx) < 60) return;
		navigate(dx > 0 ? 'prev' : 'next');
	}

	function navigate(dir: 'prev' | 'next') {
		const href = navHref(dir);
		if (!href) return;
		document.documentElement.setAttribute('data-vt-slide', dir === 'next' ? 'right' : 'left');
		goto(href).finally(() => {
			document.documentElement.removeAttribute('data-vt-slide');
		});
	}

	const maxCategory = $derived(
		data.categories.reduce(
			(max: bigint, c: { totalMinor: bigint }) => (c.totalMinor > max ? c.totalMinor : max),
			1n
		)
	);
	const catSegments = $derived(
		[...data.categories]
			.sort((a: { totalMinor: bigint }, b: { totalMinor: bigint }) =>
				Number(b.totalMinor - a.totalMinor)
			)
			.map((c: { color: string | null; totalMinor: bigint }) => ({
				value: c.totalMinor,
				color: c.color ?? '#8E8E93'
			}))
	);
	const maxBar = $derived(
		data.buckets.reduce(
			(max: bigint, b: { totalMinor: bigint }) => (b.totalMinor > max ? b.totalMinor : max),
			1n
		)
	);
	const overall = $derived(
		isMonth
			? (data.budgets.find((b: { categoryId: string | null }) => b.categoryId === null) as
					{ budgetMinor: bigint; actualMinor: bigint } | undefined)
			: undefined
	);
	const overallPct = $derived(
		overall && overall.budgetMinor > 0n
			? Number((overall.actualMinor * 1000n) / overall.budgetMinor) / 1000
			: null
	);
	const overBudget = $derived(isMonth && overallPct !== null && overallPct > 1);

	const savings = $derived(data.savingsMinor ?? 0n);
	const net = $derived(data.incomeMinor - data.totalMinor - savings);
	const prevNet = $derived(
		data.prevIncomeMinor ? data.prevIncomeMinor - data.prevTotalMinor - savings : 0n
	);
	const netChange = $derived(
		data.incomeMinor > 0n
			? Number(((net - prevNet) * 1000n) / data.incomeMinor) / 10
			: net !== prevNet
				? net > prevNet
					? Infinity
					: -Infinity
				: 0
	);
	const sp = $derived(data.incomeMinor > 0n ? Number((net * 1000n) / data.incomeMinor) / 10 : 0);

	const comparison = $derived.by(() => {
		if (data.prevTotalMinor === 0n)
			return data.totalMinor > 0n ? `First ${period} of tracking` : null;
		const pct = Number((data.totalMinor * 1000n) / data.prevTotalMinor) / 10;
		const dir = pct > 100 ? 'up' : pct < 100 ? 'down' : 'flat';
		const diff = Math.abs(pct - 100);
		if (dir === 'flat') return `Same as ${data.prevLabel}`;
		return {
			dir,
			text: `${formatPct(diff)} ${dir === 'up' ? 'more' : 'less'} than ${data.prevLabel}`
		};
	});

	const barWidth = $derived(period === 'year' ? 16 : period === 'week' ? 34 : 6);
	const barGap = $derived(period === 'year' ? 4 : period === 'week' ? 6 : 2);
	const svgW = $derived(data.buckets.length * (barWidth + barGap));

	function pctOf(part: bigint, whole: bigint): number {
		if (whole === 0n) return 0;
		return Math.min(100, Number((part * 1000n) / whole) / 10);
	}

	function navHref(dir: 'prev' | 'next'): string | null {
		if (dir === 'prev' && !data.hasPrev) return null;
		if (dir === 'next' && !data.hasNext) return null;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		params.set('period', period);
		if (period === 'day') params.set('day', dir === 'prev' ? data.prevDay : data.nextDay);
		else if (period === 'week')
			params.set('wo', String(dir === 'prev' ? data.prevWeekOffset : data.nextWeekOffset));
		else if (period === 'year') params.set('year', dir === 'prev' ? data.prevYear : data.nextYear);
		else if (period === 'month')
			params.set('month', dir === 'prev' ? data.prevMonth : data.nextMonth);
		return '?' + params.toString();
	}
</script>

<div
	class="space-y-7"
	role="region"
	aria-label="Activity period"
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	style="transform: translateX({swiping ? swipeOffset : 0}px); transition: transform {swiping
		? '0s'
		: 'var(--dur) var(--ease-out)'}; touch-action: pan-y"
>
	<div class="flex items-center justify-between px-1 pt-1">
		<h1 class="text-[28px]">Activity</h1>
	</div>

	<div class="flex justify-center">
		<div
			class="inline-flex rounded-[10px] p-0.5"
			style="background: var(--surface-2)"
			role="tablist"
		>
			{#each ['day', 'week', 'month', 'year'] as p (p)}
				{@const active = period === p}
				<a
					href="?period={p}"
					role="tab"
					aria-selected={active}
					class="press rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition-colors"
					style="color: {active ? 'var(--ink)' : 'var(--ink-3)'}; background: {active
						? 'var(--surface)'
						: 'transparent'}; box-shadow: {active
						? 'var(--shadow-card), inset 0 0 0 0.5px var(--hairline)'
						: 'none'}"
				>
					{p === 'day' ? 'Day' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
				</a>
			{/each}
		</div>
	</div>

	<div class="-mx-1 flex items-center justify-between gap-1">
		{#if data.hasPrev}
			<button
				onclick={() => navigate('prev')}
				class="press flex h-9 w-9 items-center justify-center rounded-full"
				style="color: var(--ink-3)"
				aria-label="Previous"
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
				>
			</button>
		{:else}
			<div class="h-9 w-9"></div>
		{/if}
		<span class="text-[17px] font-semibold" style="color: var(--ink)">{data.label}</span>
		{#if data.hasNext}
			<button
				onclick={() => navigate('next')}
				class="press flex h-9 w-9 items-center justify-center rounded-full"
				style="color: var(--ink-3)"
				aria-label="Next"
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg
				>
			</button>
		{:else}
			<div class="h-9 w-9"></div>
		{/if}
	</div>

	<div
		class="card-lg grain relative overflow-hidden p-6"
		style="background: radial-gradient(120% 80% at 85% -10%, color-mix(in oklab, var(--ws-accent) 24%, transparent), transparent 60%), var(--surface)"
	>
		<p class="section-label text-center">{data.label}</p>
		<div class="mt-4 flex justify-center">
			<CategoryRing
				segments={catSegments}
				cap={isMonth && overall ? overall.budgetMinor : 0n}
				size={200}
				stroke={14}
			>
				<div class="px-2" style="color: {overBudget ? 'var(--deny)' : 'inherit'}">
					<Money
						minor={data.totalMinor}
						{currency}
						block
						class="font-[family-name:var(--font-display)] text-[24px] leading-none font-semibold"
					/>
					{#if isMonth && overallPct !== null}
						<p class="num mt-1 text-[11px]" style="color: var(--ink-4)">
							of {formatMinor(overall!.budgetMinor, currency)}
						</p>
					{/if}
				</div>
			</CategoryRing>
		</div>
		{#if isMonth && overallPct !== null}
			<p
				class="mt-5 text-center text-[13px] font-medium"
				style="color: {overBudget ? 'var(--deny)' : 'var(--ink-3)'}"
			>
				{overBudget
					? `${formatPct((overallPct - 1) * 100)} over budget`
					: `${formatPct(overallPct * 100)} of budget used`}
			</p>
		{:else if comparison}
			<p
				class="mt-5 text-center text-[13px] font-medium"
				style="color: {typeof comparison === 'object' && comparison.dir === 'up'
					? 'var(--deny)'
					: typeof comparison === 'object' && comparison.dir === 'down'
						? 'var(--approve)'
						: 'var(--ink-3)'}"
			>
				{typeof comparison === 'string' ? comparison : comparison.text}
			</p>
		{/if}

		{#if period !== 'day'}
			<svg viewBox="0 0 {svgW} 44" class="mt-6 h-11 w-full">
				{#each data.buckets as b, i (b.key)}
					{@const totalH = Math.max(
						Number((b.totalMinor * 38n) / maxBar),
						b.totalMinor > 0n ? 3 : 0
					)}
					{@const x = i * (barWidth + barGap) + 1}
					{@const y = 41 - totalH}
					<!-- Stacked category segments -->
					{#if b.segments && b.segments.length > 0}
						{@const segTotal = b.segments.reduce(
							(s: bigint, seg: { value: bigint }) => s + seg.value,
							0n
						)}
						{@const stacked = b.segments.reduce(
							(
								arr: { color: string; y: number; h: number }[],
								seg: { value: bigint; color: string }
							) => {
								const segH = (Number(seg.value) * totalH) / Math.max(1, Number(segTotal));
								const segY = arr.length === 0 ? y : arr[arr.length - 1].y + arr[arr.length - 1].h;
								arr.push({ color: seg.color, y: segY, h: Math.max(1, segH) });
								return arr;
							},
							[]
						)}
						{#each stacked as seg (seg.color)}
							{#if b.href}
								<a
									href={b.href}
									class="block"
									style="opacity: {b.today ? '1' : '0.7'}"
									aria-label="{b.label}: {formatMinor(b.totalMinor, currency)} in {b.segments
										.length} categories"
								>
									<rect {x} y={seg.y} width={barWidth} height={seg.h} fill={seg.color} />
								</a>
							{:else}
								<rect
									{x}
									y={seg.y}
									width={barWidth}
									height={seg.h}
									fill={seg.color}
									opacity={b.today ? '1' : '0.7'}
								/>
							{/if}
						{/each}
						<!-- Rounded top -->
						<rect
							{x}
							{y}
							width={barWidth}
							height={totalH}
							rx={barWidth / 2}
							fill="none"
							stroke="transparent"
						/>
					{:else if b.href}
						<a
							href={b.href}
							class="block"
							style="opacity: {b.today ? '1' : '0.7'}"
							aria-label="{b.label}: {formatMinor(b.totalMinor, currency)}"
						>
							<rect
								{x}
								{y}
								width={barWidth}
								height={totalH}
								rx={barWidth / 2}
								fill={b.today ? 'var(--ws-accent)' : 'var(--surface-hi)'}
							/>
						</a>
					{:else}
						<rect
							{x}
							{y}
							width={barWidth}
							height={totalH}
							rx={barWidth / 2}
							fill={b.today ? 'var(--ws-accent)' : 'var(--surface-hi)'}
							opacity={b.today ? '1' : '0.7'}
						/>
					{/if}
				{/each}
			</svg>

			<!-- Bar labels -->
			{#if period === 'year'}
				<div class="relative mt-1" style="height: 16px">
					{#each data.buckets as b, i (b.key)}
						<a
							href={b.href}
							class="absolute top-0 block text-center text-[10px] font-medium hover:opacity-70"
							style="left: {i * (barWidth + barGap) + 1}px; width: {barWidth - 2}px; color: {b.today
								? 'var(--ink)'
								: 'var(--ink-4)'}">{b.label}</a
						>
					{/each}
				</div>
			{:else if period === 'month'}
				<div class="mt-1.5 flex justify-between" style="padding-left: 1px; padding-right: 0">
					{#each data.buckets as b (b.key)}
						{#if b.weekLabel}
							<span class="text-[9px] font-medium" style="color: var(--ink-4)">{b.weekLabel}</span>
						{/if}
					{/each}
				</div>
			{:else if period === 'week'}
				<div class="mt-1 flex" style="gap: {barGap}px; padding-left: 1px">
					{#each data.buckets as b (b.key)}
						<span
							class="block text-center text-[9px] font-medium"
							style="width: {barWidth}px; color: {b.today ? 'var(--ink)' : 'var(--ink-3)'}"
							>{b.label}</span
						>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<div>
		<p class="section-label mb-3 px-1">Net position</p>
		<div class="grid grid-cols-2 gap-2.5">
			<div class="card overflow-hidden py-1">
				<div class="flex items-center justify-between px-3.5 py-1.5">
					<span class="text-[13px] font-medium" style="color: var(--approve)">In</span>
					<Money minor={data.incomeMinor} {currency} sign class="text-[16px] font-semibold" />
				</div>
				<div class="hairline flex items-center justify-between px-3.5 py-1.5">
					<span class="text-[13px] font-medium" style="color: var(--ink-3)">Out</span>
					<Money minor={data.totalMinor} {currency} class="text-[16px] font-semibold" />
				</div>
				<div class="flex items-center justify-between px-3.5 py-1.5">
					<span class="text-[13px] font-medium" style="color: var(--seal)">Saved</span>
					<Money minor={savings} {currency} sign class="text-[16px] font-semibold" />
				</div>
			</div>
			<div
				class="card flex flex-col items-center justify-center p-4"
				style="background: {net < 0n
					? 'color-mix(in oklab, var(--deny) 8%, var(--surface))'
					: 'color-mix(in oklab, var(--approve) 8%, var(--surface))'}"
			>
				<p
					class="text-[11px] font-semibold tracking-[0.08em] uppercase"
					style="color: {net < 0n ? 'var(--deny)' : 'var(--approve)'}"
				>
					Net
				</p>
				<span style="color: {net < 0n ? 'var(--deny)' : 'var(--approve)'}">
					<Money minor={net} {currency} sign block class="mt-0.5 text-[18px] font-semibold" />
				</span>
				{#if prevNet !== 0n && net !== prevNet}
					<span
						class="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold"
						style="color: {netChange >= 0 ? 'var(--approve)' : 'var(--deny)'}"
					>
						<svg
							width="12"
							height="10"
							viewBox="0 0 12 10"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							{#if netChange >= 0}
								<path d="M2 8 C3 6, 5 2, 7 5 C8 7, 10 3, 10 2 M10 2 L8 3 M10 2 L10.5 4" />
							{:else}
								<path d="M2 2 C3 4, 5 8, 7 5 C8 3, 10 7, 10 8 M10 8 L8 7 M10 8 L10.5 6" />
							{/if}
						</svg>
						{#if Number.isFinite(netChange)}
							{formatPct(Math.abs(netChange))} vs {data.prevLabel}
						{:else}
							{netChange > 0 ? 'up' : 'down'} vs {data.prevLabel}
						{/if}
					</span>
				{/if}
			</div>
		</div>
		<p class="mt-2.5 px-1 text-[13px]" style="color: var(--ink-3)">
			{#if data.incomeMinor === 0n}
				No income recorded this {period}
			{:else if savings > 0n}
				{formatMinor(savings, currency)} in buckets · {sp >= 0
					? `${formatPct(sp)} free`
					: 'over budget'}
			{:else if sp >= 0}
				Saving {formatPct(sp)} of what came in
			{:else}
				Spending more than income this {period}
			{/if}
		</p>
	</div>

	{#if isMonth && (data.budgets.length > 0 || data.isOwner)}
		<div>
			<div class="mb-3 flex items-center justify-between px-1">
				<p class="section-label">Budgets</p>
				{#if data.isOwner}
					<button
						onclick={() => (showBudgetForm = !showBudgetForm)}
						class="press text-[13px] font-semibold"
						style="color: var(--ws-accent)"
					>
						{showBudgetForm ? 'Done' : 'Set budget'}
					</button>
				{/if}
			</div>
			{#if showBudgetForm}
				<form
					method="POST"
					action="?/setBudget"
					use:submit={{ success: 'Budget saved' }}
					class="mb-3 flex items-end gap-2"
				>
					<label class="flex-1">
						<span class="text-[11px]" style="color: var(--ink-4)">Scope</span>
						<select name="categoryId" class="field mt-1 text-[15px]">
							<option value="">Everything</option>
							{#each data.allCategories as c (c.id)}
								<option value={c.id}>{c.icon} {c.name}</option>
							{/each}
						</select>
					</label>
					<label class="w-28">
						<span class="text-[11px]" style="color: var(--ink-4)">{currency}</span>
						<input
							name="amount"
							use:money
							inputmode="decimal"
							placeholder="500"
							class="field num mt-1 text-[15px]"
						/>
					</label>
					<button class="btn btn-accent shrink-0 px-4 py-3 text-[15px]">Save</button>
				</form>
			{/if}
			{#if data.budgets.length > 0}
				<div class="space-y-4">
					{#each data.budgets as b (b.budgetId)}
						{@const pct = pctOf(b.actualMinor, b.budgetMinor)}
						{@const over = b.actualMinor > b.budgetMinor}
						<div>
							<div class="flex items-baseline justify-between px-1 text-[15px]">
								<span style="color: var(--ink)">{b.categoryIcon ?? ''} {b.categoryName}</span>
								<span class="num" style="color: {over ? 'var(--deny)' : 'var(--ink-3)'}">
									{formatMinor(b.actualMinor, currency)} / {formatMinor(b.budgetMinor, currency)}
								</span>
							</div>
							<div
								class="mt-2 h-2.5 overflow-hidden rounded-full"
								style="background: var(--surface-2)"
							>
								<div
									class="h-full rounded-full"
									style="width: {Math.min(pct, 100)}%; background: {over
										? 'var(--deny)'
										: 'var(--approve)'}; transition: width 800ms var(--ease-out)"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div>
		<p class="section-label mb-3.5 px-1">By category</p>
		{#if data.categories.length === 0}
			<p class="px-1 text-[15px]" style="color: var(--ink-4)">Nothing spent this {period}.</p>
		{:else}
			<div class="space-y-4">
				{#each data.categories as c (c.categoryId)}
					{@const pct = pctOf(c.totalMinor, data.totalMinor)}
					<div>
						<div class="flex items-baseline justify-between px-1 text-[15px]">
							<span style="color: var(--ink)">
								<span
									class="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
									style="background: {c.color ?? '#8E8E93'}"
								></span>{c.name}
							</span>
							<span class="num" style="color: var(--ink-2)">
								{formatMinor(c.totalMinor, currency)}
								<span class="ml-1 text-[12px]" style="color: var(--ink-4)">{formatPct(pct)}</span>
							</span>
						</div>
						<div
							class="mt-2 h-2.5 overflow-hidden rounded-full"
							style="background: var(--surface-2)"
						>
							<div
								class="h-full rounded-full"
								style="width: {pctOf(c.totalMinor, maxCategory)}%; background: {c.color ??
									'#8E8E93'}; transition: width 800ms var(--ease-out)"
							></div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div>
		<p class="section-label mb-2 px-1">By member</p>
		{#if data.members.length === 0}
			<p class="px-1 text-[15px]" style="color: var(--ink-4)">Nothing spent this {period}.</p>
		{:else}
			<div style="border-top: 0.5px solid var(--hairline)">
				{#each data.members as m (m.memberId)}
					<div class="hairline flex items-baseline justify-between py-3.5">
						<span class="text-[15px]" style="color: var(--ink)">{m.name}</span>
						<span class="num text-[15px] font-medium" style="color: var(--ink)"
							>{formatMinor(m.totalMinor, currency)}</span
						>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
