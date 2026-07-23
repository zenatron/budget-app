<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { money } from '$lib/actions/money';
	import { formatMinor } from '$lib/money-format';
	import { formatPct } from '$lib/format';
	import Money from '$lib/components/Money.svelte';
	import CategoryRing from '$lib/components/CategoryRing.svelte';
	import { ChevronRight, X, Sparkles } from '@lucide/svelte';
	import { page } from '$app/state';
	import { ledgerLink } from '$lib/ledger-filters';
	let { data } = $props();
	const slug = $derived(page.params.workspace!);
	let showBudgetForm = $state(false);
	const currency = $derived(data.workspace.currency);
	const period = $derived(data.period);
	const isMonth = $derived(period === 'month');

	let touchStartX = $state(0);
	let touchStartY = $state(0);
	let swiping = $state(false);
	let swipeOffset = $state(0);
	/** True from release until the view transition ends; suppresses the springback. */
	let committing = $state(false);

	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		swiping = true;
	}

	/** Past this, the drag is a commit; the card never travels further. */
	const SWIPE_LIMIT = 96;

	// Rubber-band: full tracking up to the limit, then resistance. Dragging
	// toward a period that doesn't exist resists from the start, so the end of
	// the range is something you feel rather than discover on release.
	function damp(dx: number, hasTarget: boolean): number {
		const sign = Math.sign(dx);
		const mag = Math.abs(dx);
		if (!hasTarget) return sign * Math.min(mag * 0.25, 28);
		if (mag <= SWIPE_LIMIT) return dx;
		return sign * (SWIPE_LIMIT + (mag - SWIPE_LIMIT) * 0.3);
	}

	function onTouchMove(e: TouchEvent) {
		if (!swiping) return;
		const dx = e.touches[0].clientX - touchStartX;
		const dy = e.touches[0].clientY - touchStartY;
		if (Math.abs(dy) > Math.abs(dx)) {
			swiping = false;
			swipeOffset = 0;
			return;
		}
		swipeOffset = damp(dx, dx > 0 ? data.hasPrev : data.hasNext);
	}

	function onTouchEnd(e: TouchEvent) {
		if (!swiping) {
			swipeOffset = 0;
			return;
		}
		swiping = false;
		const dx = e.changedTouches[0].clientX - touchStartX;
		const commit = Math.abs(dx) >= 60;
		// On a commit the card must not spring back first: the eased return to
		// centre and the view transition's slide are two separate motions, which
		// on device reads as the card settling twice. Drop the offset with no
		// transition so the slide is the only movement you see. A cancelled swipe
		// still eases back, because there the springback IS the feedback.
		if (!commit) {
			// Didn't travel far enough: ease back to centre. Here the springback is
			// the feedback, so it keeps its transition.
			swipeOffset = 0;
			return;
		}
		// Committed: leave the card where the finger left it. navigate() resets the
		// offset inside the view transition's callback, so the outgoing snapshot is
		// captured mid-gesture and slides on from there. Resetting first made the
		// card jump ~100px back to centre and then slide forward again — two
		// direction changes, which is the double settle you feel.
		committing = true;
		void navigate(dx > 0 ? 'prev' : 'next');
	}

	/**
	 * SvelteKit routes client-side, where the CSS-only `@view-transition` rule
	 * never applies — it covers cross-document navigation only. So the transition
	 * is started explicitly here, and only here: this is the one navigation that
	 * wants a directional slide, and a global hook would silently switch it on for
	 * every route in the app.
	 */
	async function navigate(dir: 'prev' | 'next') {
		const href = navHref(dir);
		if (!href) {
			committing = false;
			return;
		}

		const root = document.documentElement;
		const start = (
			document as Document & {
				startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> };
			}
		).startViewTransition?.bind(document);

		// Runs inside the transition, after the outgoing snapshot is taken: the
		// card returns to centre here so the reset is never visible.
		//
		// noScroll: stepping through periods keeps your place on the page. Without
		// it, SvelteKit's default scroll-to-top fired on every swipe, so comparing
		// the category breakdown across months meant scrolling back down each time.
		const step = async () => {
			swipeOffset = 0;
			await tick();
			await goto(href, { noScroll: true });
		};

		if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			await step();
			committing = false;
			return;
		}

		root.setAttribute('data-vt-slide', dir === 'next' ? 'right' : 'left');
		try {
			await start(step).finished;
		} finally {
			root.removeAttribute('data-vt-slide');
			committing = false;
		}
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

	/*
	 * Colour follows the language the rest of the app already speaks: these are
	 * the same tones the purchase state chips use, so the row doubles as a legend
	 * for what you see on a purchase.
	 *
	 *   green  approved     blue  refunded
	 *   red    denied       grey  cancelled
	 *   purple set aside (matches "Saved" in net position above)
	 *
	 * Earned is deliberately the neutral espresso. Green was doing double duty —
	 * "approved" on every chip and "In" in net position — and putting both in one
	 * row made that read as a mistake. The coloured cards all mean something
	 * happened to a request; income is the ground they sit against, not a verdict.
	 */
	const lifetimeStats = $derived([
		{ label: 'Earned', minor: data.earnedMinor, tone: 'var(--ink)', hint: 'Income recorded' },
		{
			label: 'Approved',
			minor: data.verdicts.approvedMinor,
			tone: 'var(--approve)',
			hint: 'Total spent'
		},
		{ label: 'Saved', minor: data.savedMinor, tone: 'var(--seal)', hint: 'Set aside' },
		{
			label: 'Refunded',
			minor: data.verdicts.refundedMinor,
			tone: 'var(--info)',
			hint: 'Came back'
		},
		{ label: 'Denied', minor: data.verdicts.deniedMinor, tone: 'var(--deny)', hint: 'Turned down' },
		{
			label: 'Cancelled',
			minor: data.verdicts.cancelledMinor,
			tone: 'var(--ink-3)',
			hint: 'Voided'
		},
		{
			label: 'Let go',
			minor: data.verdicts.letGoMinor,
			tone: 'var(--seal)',
			hint: 'Slept on, then passed'
		}
	]);

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
	style="touch-action: pan-y"
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

	<!--
		Docks under the workspace header once you scroll past it. The period being
		viewed is the page's whole context, and the swipe works anywhere on the
		page — so scrolling down to the category breakdown used to leave you
		swiping months with no idea which one you'd landed on.
	-->
	<div
		class="material sticky z-10 -mx-4 flex items-center justify-between gap-1 px-3 py-2"
		style="top: var(--header-h, 0px); background: color-mix(in oklab, var(--paper) 94%, transparent); box-shadow: 0 0.5px 0 var(--hairline)"
	>
		{#if data.hasPrev}
			<button
				onclick={() => void navigate('prev')}
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
				onclick={() => void navigate('next')}
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

	<!--
		The period card is the only thing that tracks the swipe. Dragging the whole
		page moved the heading, the period tabs and the arrows too, which made a
		gesture that changes one number look like the entire screen was leaving.
		`view-transition-name` scopes the follow-through slide to this card as well,
		so the drag and the transition are the same motion.
	-->
	<div
		class="card-lg grain relative overflow-hidden p-6"
		style="background: radial-gradient(120% 80% at 85% -10%, color-mix(in oklab, var(--ws-accent) 24%, transparent), transparent 60%), var(--surface); view-transition-name: vt-period-card; transform: translateX({swipeOffset}px); transition: transform {swiping ||
		committing
			? '0s'
			: 'var(--dur) var(--ease-out)'}; will-change: {swiping ? 'transform' : 'auto'}"
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
						<p class="num mt-1 text-[11px]" style="color: var(--ink-3)">
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

		{#if isMonth}
			<div class="mt-4 flex justify-center">
				<a
					href="/w/{slug}/statement?month={data.monthParam}"
					class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
					style="color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--hairline)"
				>
					<Sparkles size={13} style="color: var(--accent)" />
					Read the {data.label} statement
				</a>
			</div>
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
								: 'var(--ink-3)'}">{b.label}</a
						>
					{/each}
				</div>
			{:else if period === 'month'}
				<div class="mt-1.5 flex justify-between" style="padding-left: 1px; padding-right: 0">
					{#each data.buckets as b (b.key)}
						{#if b.weekLabel}
							<span class="text-[9px] font-medium" style="color: var(--ink-3)">{b.weekLabel}</span>
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
					class="mb-3 space-y-2"
				>
					<div class="flex items-end gap-2">
						<label class="flex-1">
							<span class="text-[11px]" style="color: var(--ink-3)">Scope</span>
							<select name="categoryId" class="field mt-1 text-[16px]">
								<option value="">Everything</option>
								{#each data.allCategories as c (c.id)}
									<option value={c.id}>{c.icon} {c.name}</option>
								{/each}
							</select>
						</label>
						<label class="w-28">
							<span class="text-[11px]" style="color: var(--ink-3)">{currency}</span>
							<input
								name="amount"
								use:money
								inputmode="decimal"
								placeholder="500"
								class="field num mt-1 text-[16px]"
							/>
						</label>
					</div>
					<div class="flex items-end gap-2">
						<label class="flex-1">
							<span class="text-[11px]" style="color: var(--ink-3)">Starts</span>
							<select name="effectiveMonth" class="field mt-1 text-[16px]">
								{#each data.budgetMonths as m (m.value)}
									<option value={m.value}>{m.label}</option>
								{/each}
							</select>
						</label>
						<button class="btn btn-accent shrink-0 px-4 py-3 text-[15px]">Save</button>
					</div>
					<p class="px-1 text-[12px]" style="color: var(--ink-3)">
						Applies from that month onward until you set another.
					</p>
				</form>
			{/if}

			<!--
				Budgets scheduled ahead of the current month. Without this they were
				invisible until the month arrived, so a plan made in advance looked
				like it hadn't saved.
			-->
			{#if data.scheduledBudgets.length > 0}
				<div class="mb-4 rounded-[14px] p-3" style="background: var(--surface-2)">
					<p class="section-label mb-2 px-1">Scheduled</p>
					{#each data.scheduledBudgets as s (s.id)}
						<div class="flex items-center justify-between gap-2 px-1 py-1.5 text-[14px]">
							<span style="color: var(--ink-2)">
								{s.categoryIcon ?? ''}
								{s.categoryName ?? 'Everything'}
								<span style="color: var(--ink-3)">· from {s.label}</span>
							</span>
							<span class="flex items-center gap-2">
								<span class="num" style="color: var(--ink)"
									>{formatMinor(s.amountMinor, currency)}</span
								>
								{#if data.isOwner}
									<form
										method="POST"
										action="?/removeScheduledBudget"
										use:submit={{
											confirm: `Remove the ${s.label} budget?`,
											success: 'Scheduled budget removed'
										}}
									>
										<input type="hidden" name="budgetId" value={s.id} />
										<button class="press" style="color: var(--ink-3)" aria-label="Remove">
											<X class="h-3.5 w-3.5" />
										</button>
									</form>
								{/if}
							</span>
						</div>
					{/each}
				</div>
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
		<div class="mb-3.5 flex items-baseline justify-between px-1">
			<p class="section-label">By category</p>
			<!--
				Says once, quietly, what every row below affords. A chevron on each row
				shows there is somewhere to go; this says where, without repeating
				"see purchases" ten times.
			-->
			{#if data.categories.length > 0}
				<span class="text-[12px]" style="color: var(--ink-3)">Tap to see purchases</span>
			{/if}
		</div>
		{#if data.categories.length === 0}
			<p class="px-1 text-[15px]" style="color: var(--ink-3)">Nothing spent this {period}.</p>
		{:else}
			<div class="space-y-1">
				{#each data.categories as c (c.categoryId)}
					{@const pct = pctOf(c.totalMinor, data.totalMinor)}
					<a
						href={ledgerLink(slug, {
							from: data.rangeFrom,
							to: data.rangeTo,
							category: c.categoryId
						})}
						class="press -mx-1 block rounded-[var(--r-sm)] px-2 py-2.5"
						aria-label="{c.name}, {formatMinor(c.totalMinor, currency)} — see purchases"
					>
						<div class="flex items-baseline justify-between text-[15px]">
							<span style="color: var(--ink)">
								<span
									class="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
									style="background: {c.color ?? '#8E8E93'}"
								></span>{c.name}
							</span>
							<span class="flex items-baseline gap-1.5">
								<span class="num" style="color: var(--ink-2)">
									{formatMinor(c.totalMinor, currency)}
									<span class="ml-1 text-[12px]" style="color: var(--ink-3)">{formatPct(pct)}</span>
								</span>
								<ChevronRight class="h-3.5 w-3.5 self-center" style="color: var(--ink-4)" />
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
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<div>
		<div class="mb-2 flex items-baseline justify-between px-1">
			<p class="section-label">By member</p>
			{#if data.members.length > 0}
				<span class="text-[12px]" style="color: var(--ink-3)">Tap to see purchases</span>
			{/if}
		</div>
		{#if data.members.length === 0}
			<p class="px-1 text-[15px]" style="color: var(--ink-3)">Nothing spent this {period}.</p>
		{:else}
			<div style="border-top: 0.5px solid var(--hairline)">
				{#each data.members as m (m.memberId)}
					<a
						href={ledgerLink(slug, {
							from: data.rangeFrom,
							to: data.rangeTo,
							member: m.memberId
						})}
						class="press hairline flex items-baseline justify-between py-3.5"
						aria-label="{m.name}, {formatMinor(m.totalMinor, currency)} — see purchases"
					>
						<span class="text-[15px]" style="color: var(--ink)">{m.name}</span>
						<span class="flex items-baseline gap-1.5">
							<span class="num text-[15px] font-medium" style="color: var(--ink)"
								>{formatMinor(m.totalMinor, currency)}</span
							>
							<ChevronRight class="h-3.5 w-3.5 self-center" style="color: var(--ink-4)" />
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<!--
		Lifetime totals, deliberately outside the period navigation above — these
		are running figures for the whole workspace, so they don't change as you
		swipe through months.

		Two rows that each mean something: what money did (in, out, set aside),
		then what happened to requests (returned, refused, withdrawn).
	-->
	<div>
		<p class="section-label mb-2 px-1">Lifetime</p>
		<div class="grid grid-cols-3 gap-2">
			{#each lifetimeStats as stat (stat.label)}
				<div class="card p-3.5">
					<p
						class="text-[11px] font-semibold tracking-[0.08em] uppercase"
						style="color: {stat.tone}"
					>
						{stat.label}
					</p>
					<p class="num mt-1.5 text-[16px] font-semibold" style="color: var(--ink)">
						{formatMinor(stat.minor, currency)}
					</p>
					<p class="mt-0.5 text-[11px] leading-tight" style="color: var(--ink-3)">{stat.hint}</p>
				</div>
			{/each}
		</div>
	</div>
</div>
