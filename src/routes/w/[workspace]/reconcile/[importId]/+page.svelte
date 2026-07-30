<script lang="ts">
	import { page } from '$app/state';
	import { submit } from '$lib/actions/submit';
	import { dismiss } from '$lib/actions/dismiss';
	import { modal } from '$lib/actions/modal';
	import { formatMinor } from '$lib/money-format';
	import { fade, scale } from 'svelte/transition';
	import { Check, ChevronLeft, EyeOff, Link2, Plus, Undo2, X } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let slug = $derived(page.params.workspace);

	/** The line whose "link by hand" picker is open, if any. */
	let linking = $state<string | null>(null);
	let linkQuery = $state('');

	const lines = $derived(data.lines);
	const currency = $derived(data.currency);

	/*
	 * The review is counted work, so the header states where it stands. `private`
	 * lines count as settled: they're accounted for by something the viewer can't
	 * see, and there's nothing further for them to do about it — leaving them in
	 * "to review" would mean the count could never reach zero.
	 */
	const settled = $derived(
		lines.filter(
			(l) =>
				l.matchState === 'confirmed' || l.matchState === 'ignored' || l.matchState === 'private'
		)
	);
	const proposed = $derived(lines.filter((l) => l.matchState === 'matched'));
	const open = $derived(lines.filter((l) => l.matchState === 'unmatched'));
	const remaining = $derived(proposed.length + open.length);

	function fmtDay(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function fmtDateLong(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const periodLabel = $derived(
		data.import.periodStart && data.import.periodEnd
			? `${fmtDay(data.import.periodStart)} – ${fmtDay(data.import.periodEnd)}`
			: data.import.filename
	);

	/** Candidates narrowed by the picker's search box, best-dated first. */
	const linkCandidates = $derived.by(() => {
		const q = linkQuery.trim().toLowerCase();
		const all = [...data.candidates].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
		if (!q) return all.slice(0, 40);
		return all
			.filter(
				(c) =>
					c.itemName.toLowerCase().includes(q) || (c.merchantName ?? '').toLowerCase().includes(q)
			)
			.slice(0, 40);
	});

	function openLinker(lineId: string) {
		linking = lineId;
		linkQuery = '';
	}

	/**
	 * "Log this" hands the line to the new-purchase screen through the same
	 * `?describe=` door the Harmony palette uses — it arrives parsed into an
	 * editable form rather than silently created.
	 */
	function describeFor(l: (typeof lines)[number]): string {
		const amount = formatMinor(l.amountMinor < 0n ? -l.amountMinor : l.amountMinor, l.currency);
		return `${amount} at ${l.rawDescription} on ${fmtDateLong(l.postedAt)}`;
	}
</script>

<svelte:head><title>{periodLabel} — Reconcile — Ledger</title></svelte:head>

{#snippet stateChip(label: string, colorVar: string)}
	<span
		class="chip"
		style="color: var({colorVar}); background: color-mix(in oklab, var({colorVar}) 14%, transparent)"
		>{label}</span
	>
{/snippet}

{#snippet lineRow(l: (typeof lines)[number], last: boolean)}
	<div class="py-3.5 {last ? '' : 'hairline'}">
		<!-- The statement's own words, and its amount, always the top line: this is
		     the thing being explained, so it reads first. -->
		<div class="flex items-baseline justify-between gap-3">
			<div class="min-w-0 flex-1">
				<p class="truncate text-[15px] font-medium" style="color: var(--ink)">
					{l.rawDescription}
				</p>
				<p class="num mt-0.5 text-[13px]" style="color: var(--ink-3)">{fmtDay(l.postedAt)}</p>
			</div>
			<span class="num shrink-0 text-[15px] font-semibold" style="color: var(--ink)">
				{formatMinor(l.amountMinor < 0n ? -l.amountMinor : l.amountMinor, l.currency)}
			</span>
		</div>

		{#if l.matchState === 'private'}
			<!--
				Accounted for by a purchase this person can't see. It says that much and
				no more: no item, no merchant, no member, no link to follow. Without the
				line, an unexplained row invites someone to log a duplicate of a gift
				they're not meant to know about — which is the louder disclosure.
			-->
			<p class="mt-2 flex items-center gap-1.5 text-[13px]" style="color: var(--seal)">
				<EyeOff class="h-3.5 w-3.5 shrink-0" />
				<span>Accounted for — hidden from you</span>
			</p>
		{:else if l.purchase}
			<div class="mt-2 flex items-center gap-2.5">
				<a
					href="/w/{slug}/purchases/{l.purchase.id}"
					class="press flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2"
					style="background: var(--surface-2)"
				>
					{#if l.purchase.categoryIcon}<span class="shrink-0">{l.purchase.categoryIcon}</span>{/if}
					<span class="min-w-0 flex-1 truncate text-[14px]" style="color: var(--ink-2)">
						{l.purchase.itemName}{l.purchase.merchantName ? ` · ${l.purchase.merchantName}` : ''}
					</span>
					<!--
						The reason is shown only when the evidence is *thin*. A match on
						amount, date and description needs no caption: the bank's words and
						the item name are sitting next to each other on this very row, so
						the caption only restated what you can already see — and repeated
						down 25 rows it became wallpaper, which is how a real warning gets
						missed. A match on amount and date alone is the one worth a second
						look, so that is the one that speaks.
					-->
					{#if l.matchReason && l.matchReason !== 'amount, date and description'}
						<span class="shrink-0 text-[12px]" style="color: var(--pending)">{l.matchReason}</span>
					{/if}
				</a>
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				{#if l.matchState === 'confirmed'}
					{@render stateChip('Cleared', '--approve')}
					<form method="POST" action="?/unlink" use:submit={{ success: 'Match undone' }}>
						<input type="hidden" name="lineId" value={l.id} />
						<button class="press flex items-center gap-1.5 text-[13px]" style="color: var(--ink-3)">
							<Undo2 class="h-3.5 w-3.5" /> Undo
						</button>
					</form>
				{:else}
					<form method="POST" action="?/confirm" use:submit={{ success: 'Cleared' }}>
						<input type="hidden" name="lineId" value={l.id} />
						<button class="btn btn-accent px-3.5 py-1.5 text-[13px]">
							<Check class="h-3.5 w-3.5" /> That's it
						</button>
					</form>
					<form method="POST" action="?/unlink" use:submit={{ success: 'Match removed' }}>
						<input type="hidden" name="lineId" value={l.id} />
						<button class="press flex items-center gap-1.5 text-[13px]" style="color: var(--ink-3)">
							<X class="h-3.5 w-3.5" /> Not this
						</button>
					</form>
				{/if}
			</div>
		{:else if l.matchState === 'ignored'}
			<div class="mt-2 flex items-center gap-3">
				{@render stateChip('Set aside', '--ink-4')}
				<form method="POST" action="?/unignore" use:submit={{ success: 'Back in review' }}>
					<input type="hidden" name="lineId" value={l.id} />
					<button class="press flex items-center gap-1.5 text-[13px]" style="color: var(--ink-3)">
						<Undo2 class="h-3.5 w-3.5" /> Put back
					</button>
				</form>
			</div>
		{:else}
			<!-- Nothing here matches it. Three honest answers: it's this purchase,
			     it was never recorded, or it isn't a purchase at all. -->
			<div class="mt-2.5 flex flex-wrap items-center gap-2">
				<button
					onclick={() => openLinker(l.id)}
					class="btn btn-ghost px-3.5 py-1.5 text-[13px]"
					style="color: var(--ink-2)"
				>
					<Link2 class="h-3.5 w-3.5" /> Link a purchase
				</button>
				<a
					href="/w/{slug}/purchases/new?describe={encodeURIComponent(describeFor(l))}"
					class="btn btn-ghost px-3.5 py-1.5 text-[13px]"
					style="color: var(--ink-2)"
				>
					<Plus class="h-3.5 w-3.5" /> Log it
				</a>
				<form method="POST" action="?/ignore" use:submit={{ success: 'Set aside' }}>
					<input type="hidden" name="lineId" value={l.id} />
					<button
						class="press flex items-center gap-1.5 px-1 text-[13px]"
						style="color: var(--ink-3)"
					>
						Not a purchase
					</button>
				</form>
			</div>
		{/if}
	</div>
{/snippet}

<div class="mx-auto max-w-lg">
	<a
		href="/w/{slug}/reconcile"
		class="press mb-4 -ml-1 inline-flex items-center gap-0.5 text-[14px] font-medium"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Statements
	</a>

	<!-- Editorial masthead, as elsewhere: the period as the headline, the state of
	     the work as the standfirst. -->
	<div class="px-1">
		<p class="section-label">Statement</p>
		<h1 class="mt-1 text-[28px]">{periodLabel}</h1>
		<p class="mt-2 text-[15px]" style="color: var(--ink-3)">
			{#if remaining === 0}
				All {data.import.lineCount}
				{data.import.lineCount === 1 ? 'line' : 'lines'} accounted for.
			{:else}
				<span class="num">{remaining}</span>
				of <span class="num">{data.import.lineCount}</span> still to account for.
			{/if}
		</p>
	</div>

	{#if form?.error}
		<div
			class="card mt-4 p-4 text-[15px]"
			style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
		>
			{form.error}
		</div>
	{/if}

	{#if proposed.length > 0}
		<!-- Green, like the APPROVED chip: these are found, they just need a nod. -->
		<p class="section-label mt-7 mb-1 px-1" style="color: var(--approve)">
			Looks like a match · {proposed.length}
		</p>
		<div class="rule">
			{#each proposed as l, i (l.id)}
				{@render lineRow(l, i === proposed.length - 1)}
			{/each}
		</div>
	{/if}

	{#if open.length > 0}
		<p class="section-label mt-7 mb-1 px-1" style="color: var(--pending)">
			Nothing matched · {open.length}
		</p>
		<div class="rule">
			{#each open as l, i (l.id)}
				{@render lineRow(l, i === open.length - 1)}
			{/each}
		</div>
	{/if}

	{#if settled.length > 0}
		<p class="section-label mt-7 mb-1 px-1">Accounted for · {settled.length}</p>
		<div class="rule">
			{#each settled as l, i (l.id)}
				{@render lineRow(l, i === settled.length - 1)}
			{/each}
		</div>
	{/if}
</div>

{#if linking}
	{@const lineId = linking}
	<div
		class="fixed inset-0 z-50"
		style="background: var(--scrim)"
		use:dismiss={() => (linking = null)}
		transition:fade={{ duration: 140 }}
	></div>
	<div
		class="fixed inset-x-4 top-[10vh] z-50 mx-auto flex max-h-[80vh] max-w-md flex-col"
		role="dialog"
		aria-modal="true"
		aria-label="Link a purchase"
		tabindex="-1"
		use:modal
		transition:scale={{ start: 0.96, duration: 170 }}
	>
		<div
			class="card-lg flex min-h-0 flex-col overflow-hidden"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
		>
			<div class="flex items-center justify-between px-5 pt-4 pb-3.5">
				<h2 class="font-[family-name:var(--font-display)] text-[22px]" style="color: var(--ink)">
					Link a purchase
				</h2>
				<button
					onclick={() => (linking = null)}
					class="press -mr-1 flex h-8 w-8 items-center justify-center rounded-full"
					style="color: var(--ink-3)"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="px-5 pb-3">
				<label>
					<span class="sr-only">Search purchases</span>
					<input bind:value={linkQuery} placeholder="Search purchases…" class="field text-[16px]" />
				</label>
			</div>
			<div class="h-px" style="background: var(--hairline)"></div>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-2">
				{#if linkCandidates.length === 0}
					<p class="py-8 text-center text-[14px]" style="color: var(--ink-3)">
						{data.candidates.length === 0
							? 'Every purchase in this period is already matched.'
							: 'No purchases match that search.'}
					</p>
				{:else}
					{#each linkCandidates as c, i (c.id)}
						<form
							method="POST"
							action="?/link"
							use:submit={{ success: 'Linked', onSuccess: () => (linking = null) }}
						>
							<input type="hidden" name="lineId" value={lineId} />
							<input type="hidden" name="purchaseId" value={c.id} />
							<button
								class="press flex w-full items-center gap-3 py-3 text-left {i ===
								linkCandidates.length - 1
									? ''
									: 'hairline'}"
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[15px]" style="color: var(--ink)"
										>{c.itemName}</span
									>
									<span class="mt-0.5 block truncate text-[13px]" style="color: var(--ink-3)">
										{c.merchantName ? `${c.merchantName} · ` : ''}{fmtDay(c.completedAt)}
									</span>
								</span>
								<span class="num shrink-0 text-[15px]" style="color: var(--ink-2)">
									{formatMinor(c.amountMinor, currency)}
								</span>
							</button>
						</form>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
