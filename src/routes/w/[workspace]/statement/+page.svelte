<script lang="ts">
	import { page } from '$app/state';
	import Money from '$lib/components/Money.svelte';
	import { ledgerLink } from '$lib/ledger-filters';
	import { Sparkles, Printer, ChevronLeft, ChevronRight } from '@lucide/svelte';

	let { data } = $props();
	const slug = $derived(page.params.workspace!);
	const currency = $derived(data.workspace.currency);
	const f = $derived(data.figures);
	const s = $derived(data.summary);

	// The month's verdict picks the accent the sheet is read through.
	const TONE_COLOR: Record<string, string> = {
		saved: 'var(--approve)',
		over: 'var(--deny)',
		even: 'var(--ink)',
		neutral: 'var(--ink)',
		budget: 'var(--ink)'
	};
	const heroColor = $derived(TONE_COLOR[data.narration.tone] ?? 'var(--ink)');

	// The hero figure: net when we can see it, spent when income is untracked.
	const heroLabel = $derived(
		s.status === 'neutral' ? (f.isPartial ? 'Spent so far' : 'Spent this month') : 'Net position'
	);
	const heroMinor = $derived(s.status === 'neutral' ? f.spentMinor : s.netMinor);
	const heroSign = $derived(s.status !== 'neutral');

	const outMinor = $derived(f.spentMinor);
	const flows = $derived([
		{ label: 'In', minor: f.incomeMinor, sign: true, hide: f.incomeMinor === 0n },
		{ label: 'Out', minor: -outMinor, sign: true, hide: false },
		{ label: 'Set aside', minor: -f.savingsMinor, sign: true, hide: f.savingsMinor === 0n }
	]);

	const catMax = $derived(
		data.categories.reduce((m: bigint, c) => (c.totalMinor > m ? c.totalMinor : m), 1n)
	);
	function pct(part: bigint, whole: bigint): number {
		return whole > 0n ? Number((part * 100n) / whole) : 0;
	}

	function printSheet() {
		window.print();
	}
</script>

<svelte:head><title>{data.label} statement · {data.workspace.name}</title></svelte:head>

<!-- Month navigation: screen only, never printed. -->
<header class="screen-only sticky top-0 z-10 flex items-center justify-between px-4 py-3"
	style="background: color-mix(in oklab, var(--paper) 92%, transparent); box-shadow: 0 0.5px 0 var(--hairline)">
	<a
		class="grid h-9 w-9 place-items-center rounded-full"
		style="color: {data.hasPrev ? 'var(--ink-2)' : 'var(--ink-4)'}; pointer-events: {data.hasPrev
			? 'auto'
			: 'none'}"
		href="?month={data.prevMonth}"
		aria-label="Previous month"><ChevronLeft size={20} /></a>
	<div class="text-center">
		<p class="text-[15px] font-semibold" style="color: var(--ink)">{data.label}</p>
		{#if data.isPartial}
			<p class="text-[10px] font-medium tracking-wide uppercase" style="color: var(--ink-3)">
				In progress
			</p>
		{/if}
	</div>
	<a
		class="grid h-9 w-9 place-items-center rounded-full"
		style="color: {data.hasNext ? 'var(--ink-2)' : 'var(--ink-4)'}; pointer-events: {data.hasNext
			? 'auto'
			: 'none'}"
		href="?month={data.nextMonth}"
		aria-label="Next month"><ChevronRight size={20} /></a>
</header>

<article class="sheet mx-auto max-w-[560px] px-6 pt-6 pb-24">
	<!-- Masthead -->
	<div class="flex items-baseline justify-between">
		<div>
			<p class="section-label">Statement</p>
			<h1
				class="mt-1 text-[26px] leading-none font-semibold font-[family-name:var(--font-display)]"
				style="color: var(--ink)">
				{data.workspace.name}
			</h1>
		</div>
		<button
			onclick={printSheet}
			class="screen-only grid h-9 w-9 place-items-center rounded-full"
			style="color: var(--ink-3); box-shadow: inset 0 0 0 1px var(--hairline)"
			aria-label="Print this statement"><Printer size={16} /></button>
	</div>
	<p class="mt-1.5 text-[13px]" style="color: var(--ink-3)">
		{data.label}{#if data.isPartial}, through {data.asOf}{/if}
	</p>

	<div class="my-6 h-px" style="background: var(--hairline-strong)"></div>

	<!-- The hero figure -->
	<div>
		<p class="section-label">{heroLabel}</p>
		<div class="mt-1 flex items-end gap-2">
			<Money
				minor={heroMinor}
				{currency}
				sign={heroSign}
				block
				class="text-[44px] leading-none font-semibold font-[family-name:var(--font-display)]"
			/>
		</div>
		<p class="mt-2 text-[13px]" style="color: {heroColor}">{data.narration.lead}</p>
	</div>

	<!-- Harmony's read -->
	{#if data.narration.notes.length > 0}
		<div class="mt-6 rounded-2xl p-4" style="background: var(--surface); box-shadow: inset 0 0 0 1px var(--hairline)">
			<p class="mb-2 flex items-center gap-1.5 section-label">
				<Sparkles size={13} style="color: var(--accent)" /> Harmony's read
			</p>
			<ul class="space-y-1.5">
				{#each data.narration.notes as note}
					<li class="text-[13px] leading-snug" style="color: var(--ink-2)">{note}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Flows: the statement ledger -->
	<dl class="mt-7">
		{#each flows as row}
			{#if !row.hide}
				<div
					class="flex items-baseline justify-between border-b py-2.5"
					style="border-color: var(--hairline)">
					<dt class="text-[14px]" style="color: var(--ink-2)">{row.label}</dt>
					<dd class="num text-[15px] font-medium" style="color: var(--ink)">
						<Money minor={row.minor} {currency} sign={row.sign} />
					</dd>
				</div>
			{/if}
		{/each}
		{#if s.status !== 'neutral'}
			<div class="flex items-baseline justify-between py-3">
				<dt class="text-[14px] font-semibold" style="color: var(--ink)">Net</dt>
				<dd
					class="num text-[17px] font-semibold font-[family-name:var(--font-display)]"
					style="color: {heroColor}">
					<Money minor={s.netMinor} {currency} sign />
				</dd>
			</div>
		{/if}
	</dl>

	<!-- Where it went -->
	{#if data.categories.length > 0}
		<section class="mt-7">
			<p class="section-label mb-3">Where it went</p>
			<div class="space-y-2.5">
				{#each data.categories as c}
					<a
						href={ledgerLink(slug, {
							from: data.rangeFrom,
							to: data.rangeTo,
							category: c.categoryId
						})}
						class="block">
						<div class="flex items-baseline justify-between">
							<span class="text-[14px]" style="color: var(--ink-2)">{c.name}</span>
							<span class="num text-[14px] font-medium" style="color: var(--ink)">
								<Money minor={c.totalMinor} {currency} />
							</span>
						</div>
						<div class="mt-1.5 h-1 overflow-hidden rounded-full" style="background: var(--hairline)">
							<div
								class="h-full rounded-full"
								style="width: {pct(c.totalMinor, catMax)}%; background: {c.color ?? 'var(--ink-3)'}">
							</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Household split -->
	{#if data.members.length > 1}
		<section class="mt-7">
			<p class="section-label mb-3">Who spent it</p>
			<div class="space-y-2">
				{#each data.members as m}
					<div class="flex items-baseline justify-between">
						<span class="text-[14px]" style="color: var(--ink-2)">{m.name}</span>
						<span class="num text-[14px] font-medium" style="color: var(--ink)">
							<Money minor={m.totalMinor} {currency} />
						</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Fine print -->
	<footer class="mt-8 border-t pt-4 text-[11px] leading-relaxed" style="border-color: var(--hairline); color: var(--ink-3)">
		<p>
			{f.txCount}
			{f.txCount === 1 ? 'purchase' : 'purchases'} recorded{#if data.isPartial}, through {data.asOf}{/if}. Figures reflect
			what you can see: sealed purchases appear only to those they're shared with.
		</p>
		<a href={ledgerLink(slug, { from: data.rangeFrom, to: data.rangeTo })} class="screen-only mt-2 inline-block font-medium" style="color: var(--accent)">
			Open the full ledger for {data.label}
		</a>
	</footer>
</article>

<style>
	/* The sheet reads as paper on screen, and prints as ink on white with the
	   chrome (nav, tab bar, buttons, bars) stripped away. */
	@media print {
		:global(.screen-only) {
			display: none !important;
		}
		:global(nav) {
			display: none !important;
		}
		.sheet {
			max-width: none;
			padding: 0;
		}
	}
</style>
