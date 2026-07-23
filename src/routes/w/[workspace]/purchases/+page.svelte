<script lang="ts">
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { scale, fade, slide } from 'svelte/transition';
	import {
		Check,
		ChevronDown,
		CircleHelp,
		Funnel,
		Landmark,
		Lock,
		Moon,
		RotateCcw,
		Search,
		ShoppingBag,
		Sparkles,
		X
	} from '@lucide/svelte';
	import Money from '$lib/components/Money.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { swipe } from '$lib/actions/swipe';
	import { submit } from '$lib/actions/submit';
	import type { ConfirmSpec } from '$lib/confirm-state.svelte';
	import { goto } from '$app/navigation';
	import { formatMinor } from '$lib/money-format';
	import { narrateSafeToSpend } from '$lib/domain/forecast/safe-to-spend';
	import { NO_CATEGORY } from '$lib/ledger-filters';
	import { toastError } from '$lib/toast-state.svelte';
	let { data } = $props();
	let slug = $derived(page.params.workspace);

	/*
	 * Search and category live in the URL, like `movements`. Filtering used to
	 * happen client-side over whatever had been fetched, which meant it searched
	 * the loaded page rather than the workspace, and "Show more" had to be hidden
	 * whenever a filter was on because paging filtered results was incoherent.
	 */
	let search = $state(page.url.searchParams.get('q') ?? '');
	const category = $derived(page.url.searchParams.get('category') ?? '');
	const member = $derived(page.url.searchParams.get('member') ?? '');
	const from = $derived(page.url.searchParams.get('from') ?? '');
	const to = $derived(page.url.searchParams.get('to') ?? '');
	const activeQuery = $derived(page.url.searchParams.get('q') ?? '');
	let showFilter = $state(false);

	// Filter-chip states. Selected = ink fill / paper text (ink is the primary
	// action color in this theme); unselected = hairline outline on surface-2.
	const SELECTED =
		'color: var(--paper); background: var(--ink); box-shadow: none; font-weight: 600';
	const UNSELECTED =
		'color: var(--ink-2); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--hairline); font-weight: 500';
	let loadingMore = $state(false);

	/*
	 * The chips below the search box, one per active filter. You can arrive here
	 * from a figure on the analytics page, so the list is often already narrowed
	 * before you've touched anything — without a visible, removable account of
	 * why, a filtered ledger just looks like a ledger that lost your data.
	 */
	const activeFilters = $derived.by(() => {
		const out: { key: string; label: string; clear: Record<string, string> }[] = [];
		if (from || to) {
			out.push({
				key: 'date',
				label:
					from && to
						? `${fmtDay(from)} – ${fmtDay(to)}`
						: from
							? `From ${fmtDay(from)}`
							: `Until ${fmtDay(to)}`,
				clear: { from: '', to: '', basis: '' }
			});
		}
		if (member) {
			const name = data.members.find((m) => m.id === member)?.name ?? 'Member';
			out.push({ key: 'member', label: name, clear: { member: '' } });
		}
		if (category) {
			const name =
				category === NO_CATEGORY
					? 'Other'
					: (data.categories.find((c) => c.id === category)?.name ?? 'Category');
			out.push({ key: 'category', label: name, clear: { category: '' } });
		}
		return out;
	});

	const hasFilters = $derived(activeFilters.length > 0);

	let items = $state<typeof data.entries>([]);
	let hasMore = $state(false);

	// Re-seed from the server list whenever it changes, not just on first paint.
	// An SSE invalidation refreshes `data` but the paginated `items` array is
	// what renders, so gating on `items.length === 0` froze the list on stale
	// rows after any live update.
	$effect(() => {
		items = [...data.entries];
		hasMore = data.hasMore;
	});

	// Keep the box in step when the URL changes underneath it — back button,
	// or the clear affordance.
	$effect(() => {
		const fromUrl = activeQuery;
		if (fromUrl !== untrack(() => search)) search = fromUrl;
	});

	type Entry = (typeof items)[number];
	const isPurchase = (e: Entry): e is Extract<Entry, { kind: 'purchase' }> => e.kind === 'purchase';

	/** The server already filtered; the client only groups. */
	const filtered = $derived(items);

	function navigateWith(changes: Record<string, string>, opts: { replace?: boolean } = {}) {
		const next = new URL(page.url);
		for (const [k, v] of Object.entries(changes)) {
			if (v) next.searchParams.set(k, v);
			else next.searchParams.delete(k);
		}
		return goto(next, {
			noScroll: true,
			keepFocus: true,
			replaceState: opts.replace ?? false
		});
	}

	// Debounced so typing doesn't fire a request per keystroke, and replaces
	// history so the back button doesn't walk letter by letter.
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void navigateWith({ q: search }, { replace: true }), 250);
	}

	// These commit a filter but leave the modal open, so you can stack a date, a
	// member and a category in one visit and see each selection land. The modal
	// closes on Done / dismiss, not on each pick.
	function pickCategory(id: string) {
		void navigateWith({ category: id });
	}

	function pickMember(id: string) {
		void navigateWith({ member: id });
	}

	/*
	 * Changing a date by hand drops the spend basis. The basis is only ever set
	 * by a drill-through link, and it means "the rows behind that figure"; once
	 * you move the window yourself you are no longer looking at that figure, and
	 * silently keeping a stricter filter would hide pending rows for no reason
	 * you could see.
	 */
	function setRange(next: { from?: string; to?: string }) {
		void navigateWith({ ...next, basis: '' });
	}

	function clearFilters() {
		void navigateWith({ category: '', member: '', from: '', to: '', basis: '' });
	}

	// The "Bucket activity" toggle is remembered per user: it's a lasting
	// preference about how you read the ledger, not a per-visit filter.
	const MOVEMENTS_KEY = 'ledger-movements';

	/** Reloads from the server: it changes what gets paged over, not just shown. */
	function toggleMovements() {
		const next = data.includeMovements ? '' : '1';
		try {
			localStorage.setItem(MOVEMENTS_KEY, next === '1' ? '1' : '0');
		} catch {
			/* storage unavailable — still applies for this session */
		}
		void navigateWith({ movements: next });
	}

	// Apply the stored preference on first load, unless the URL already says
	// (e.g. a shared or drill-through link, which wins and updates the pref).
	onMount(() => {
		try {
			if (page.url.searchParams.has('movements')) {
				localStorage.setItem(MOVEMENTS_KEY, data.includeMovements ? '1' : '0');
			} else if (localStorage.getItem(MOVEMENTS_KEY) === '1') {
				void navigateWith({ movements: '1' }, { replace: true });
			}
		} catch {
			/* storage unavailable — no persistence this session */
		}
	});

	function clearSearch() {
		search = '';
		clearTimeout(searchTimer);
		void navigateWith({ q: '' }, { replace: true });
	}

	const stateVar: Record<string, string> = {
		pending_approval: '--pending',
		approved: '--approve',
		denied: '--deny',
		refunded: '--info',
		held: '--seal',
		cancelled: '--ink-4',
		draft: '--ink-4'
	};
	const stateLabel: Record<string, string> = {
		pending_approval: 'Pending',
		approved: 'Approved',
		denied: 'Denied',
		refunded: 'Refunded',
		held: 'Sleeping',
		cancelled: 'Cancelled',
		draft: 'Draft'
	};

	type P = Extract<Entry, { kind: 'purchase' }>;
	const pending = $derived(
		filtered.filter((e): e is P => isPurchase(e) && e.state === 'pending_approval')
	);

	// Confirmation shown before a swipe-to-decide finalizes — it surfaces the
	// requester's note so the approver sees the reason before committing.
	function decideBody(p: P): string {
		const head = `${p.itemName} · ${formatMinor(p.amountMinor, p.currency)} · ${p.requesterName}`;
		return p.note ? `${head}\n“${p.note}”` : `${head}\nNo note provided.`;
	}
	function approveSpec(p: P): ConfirmSpec {
		return { title: 'Approve this request?', body: decideBody(p), confirmLabel: 'Approve' };
	}
	function denySpec(p: P): ConfirmSpec {
		return {
			title: 'Deny this request?',
			body: decideBody(p),
			confirmLabel: 'Deny',
			tone: 'danger'
		};
	}

	/*
	 * "Confirm what you paid": your approved-but-unconfirmed purchases, served
	 * whole (not from the paged feed) so an old backfilled one can't be missed.
	 * Only shown on the default view — under a search or filter you want raw
	 * results, not a standing to-do header — and there, those rows are left to
	 * appear in Recent normally instead.
	 */
	// Filter to purchase-kind so the row snippet's type narrows; the server only
	// ever puts purchases here, this just tells the compiler that.
	const confirmItems = $derived(data.awaitingConfirmation.filter(isPurchase));
	const showConfirm = $derived(!hasFilters && !activeQuery && confirmItems.length > 0);
	// "Sleep on it": paused requests, served whole like the confirm to-do.
	const sleepingItems = $derived(data.sleeping.filter(isPurchase));
	const showSleeping = $derived(!hasFilters && !activeQuery && sleepingItems.length > 0);
	const rest = $derived(
		filtered.filter((e) => {
			if (isPurchase(e) && e.state === 'pending_approval') return false;
			if (showSleeping && isPurchase(e) && e.state === 'held') return false;
			if (showConfirm && isPurchase(e) && e.state === 'approved' && e.mine) return false;
			return true;
		})
	);

	/** "3 days left" · "tomorrow" · "ready". */
	function heldLeft(iso: string | null): string {
		if (!iso) return '';
		const ms = new Date(iso).getTime() - Date.now();
		if (ms <= 0) return 'ready';
		const days = Math.ceil(ms / 86_400_000);
		return days <= 1 ? 'tomorrow' : `${days} days left`;
	}

	// Harmony's Safe to Spend — the hero. Only on the unfiltered view: under a
	// search it'd be noise, and the number is a whole-month figure regardless.
	const f = $derived(data.forecast);
	const showForecast = $derived(!hasFilters && !activeQuery);
	// The runway waterfall unfolds in place: income minus everything already
	// spent, promised, and set aside, arriving at the free number above.
	let showRunway = $state(false);
	// Harmony's read of the number — deterministic interpretation, not an LLM call.
	const narration = $derived(narrateSafeToSpend(f, (m) => formatMinor(m, data.currency)));
	const narrationColor = $derived(
		narration.tone === 'over'
			? 'var(--deny)'
			: narration.tone === 'tight' || narration.tone === 'budget'
				? 'var(--pending)'
				: 'var(--ink-3)'
	);
	/** "Jul 31" — the last day of the horizon month. */
	function monthEndLabel(): string {
		const t = f.horizon.toExclusive; // first of next month
		const last = new Date(Date.UTC(t.y, t.m - 1, 1) - 86_400_000);
		return last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
	}

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		try {
			// One-shot fetch URL, not reactive state. It carries the page's whole
			// query so the next page is filtered exactly like the first — copying
			// the current params is what keeps that true as filters are added,
			// rather than a hand-maintained list that silently falls behind.
			// Built as string pairs rather than a URLSearchParams instance: this is a
			// throwaway value read once, and a mutable URLSearchParams in component
			// scope is the reactivity footgun svelte/prefer-svelte-reactivity warns
			// about.
			const qs = [...page.url.searchParams.entries()]
				.filter(([k]) => k !== 'offset')
				.concat([['offset', String(items.length)]])
				.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
				.join('&');
			const res = await fetch(`/w/${slug}/purchases/data?${qs}`);
			if (!res.ok) throw new Error(String(res.status));
			const json = await res.json();
			items = [...items, ...json.entries];
			hasMore = json.hasMore;
		} catch {
			// Failing silently left "Show more" looking like a no-op button.
			toastError("Couldn't load more");
		}
		loadingMore = false;
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	/** "2026-06-01" -> "Jun 1". Parsed as parts, not Date: `new Date('2026-06-01')`
	 *  is UTC midnight, which renders as the day before west of Greenwich. */
	function fmtDay(ymd: string): string {
		const [y, m, d] = ymd.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#snippet movementRow(m: Extract<Entry, { kind: 'movement' }>, last: boolean)}
	<!--
		Deliberately quieter than a purchase. An accrual isn't spending — it's your
		own money moving sideways — and giving it equal weight would dilute what
		the page is for.
	-->
	<a
		href="/w/{slug}/buckets"
		class="press flex items-center gap-3 px-1 py-2.5 {last ? '' : 'hairline'}"
	>
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
			style="background: color-mix(in oklab, {m.bucketColor ??
				'var(--seal)'} 14%, var(--surface-2))"
		>
			<Landmark class="h-[16px] w-[16px]" style="color: {m.bucketColor ?? 'var(--seal)'}" />
		</span>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[15px]" style="color: var(--ink-2)">
				{m.type === 'accrual' ? 'Set aside' : m.type === 'withdrawal' ? 'Taken from' : 'Adjusted'}
				{m.bucketName}
			</p>
			<p class="mt-0.5 text-[13px]" style="color: var(--ink-3)">
				{m.note ?? 'Bucket'} · {fmtDate(m.at)}
			</p>
		</div>
		<span class="num shrink-0 text-[15px]" style="color: var(--ink-3)">
			{m.amountMinor >= 0n ? '+' : ''}{formatMinor(m.amountMinor, m.currency)}
		</span>
	</a>
{/snippet}

{#snippet row(p: P, last: boolean)}
	<!-- Swipe left to reveal a row's primary action: Approve/Deny for a pending
	     request you can decide, or Confirm for your own approved-but-unconfirmed
	     charge. Deciding shows a confirmation with the requester's note first;
	     Confirm opens the detail page to enter what you actually paid. -->
	{@const decide = p.state === 'pending_approval' && p.canDecide}
	{@const confirm = p.state === 'approved' && p.mine}
	{@const swipeW = decide ? 176 : confirm ? 116 : 0}
	<div
		class="relative overflow-hidden {last ? '' : 'hairline'}"
		use:swipe={{ width: swipeW, enabled: swipeW > 0 }}
	>
		{#if decide}
			<div class="absolute inset-y-0 right-0 z-0 flex">
				<form
					method="POST"
					action="/w/{slug}/purchases/{p.id}?/deny"
					use:submit={{ confirm: denySpec(p), success: 'Denied' }}
					class="contents"
				>
					<button
						class="press flex h-full w-[88px] flex-col items-center justify-center gap-1 text-[13px] font-semibold"
						style="background: var(--deny); color: var(--paper)"
					>
						<X class="h-4 w-4" /> Deny
					</button>
				</form>
				<form
					method="POST"
					action="/w/{slug}/purchases/{p.id}?/approve"
					use:submit={{ confirm: approveSpec(p), success: 'Approved' }}
					class="contents"
				>
					<button
						class="press flex h-full w-[88px] flex-col items-center justify-center gap-1 text-[13px] font-semibold"
						style="background: var(--approve); color: var(--paper)"
					>
						<Check class="h-4 w-4" /> Approve
					</button>
				</form>
			</div>
		{:else if confirm}
			<a
				href="/w/{slug}/purchases/{p.id}"
				class="absolute inset-y-0 right-0 z-0 flex items-center gap-1.5 pr-4 pl-5 text-[14px] font-semibold"
				style="background: var(--approve); color: var(--paper)"
			>
				<Check class="h-4 w-4" /> Confirm
			</a>
		{/if}
		<a
			href="/w/{slug}/purchases/{p.id}"
			data-swipe-content
			class="press relative z-10 flex items-center gap-3 px-1 py-3"
			style="view-transition-name: vt-card-{p.id}; background: var(--paper); touch-action: pan-y"
		>
			<!--
			A refund borrows the original purchase's photo and dims it under a
			reversal arrow: you recognize the item at a glance, and it can't be
			mistaken for a second purchase of the same thing. With no original
			photo, the arrow stands in for the generic bag.
		-->
			{#if p.thumbBlobId}
				<span class="relative h-10 w-10 shrink-0">
					<!--
					Cropped from the top, not the centre. At 40px a letterboxed thumb
					would shrink the content to nothing, so the square crop stays — but
					receipts, bills and product shots all carry the identifying thing
					(logo, vendor, item) at the top, and centre-cropping a receipt
					showed a band of blank paper.
				-->
					<img
						src="/w/{slug}/blobs/{p.thumbBlobId}"
						alt=""
						class="h-10 w-10 rounded-[12px] object-cover object-top"
						style="box-shadow: inset 0 0 0 0.5px var(--hairline); {p.isRefund
							? 'filter: grayscale(0.45) brightness(0.82)'
							: ''}"
					/>
					{#if p.isRefund}
						<span class="absolute inset-0 flex items-center justify-center">
							<RotateCcw class="h-[18px] w-[18px] text-white drop-shadow" />
						</span>
					{/if}
				</span>
			{:else}
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[18px]"
					style="background: var(--surface-2); box-shadow: inset 0 0 0 0.5px var(--hairline)"
				>
					{#if p.isRefund}
						<RotateCcw class="h-[18px] w-[18px]" style="color: var(--ink-4)" />
					{:else}
						<ShoppingBag class="h-[18px] w-[18px]" style="color: var(--ink-4)" />
					{/if}
				</span>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="truncate text-[16px] font-medium" style="color: var(--ink)"
						>{p.itemName}</span
					>
					{#if p.sealed}
						<span
							role="img"
							title="Sealed — hidden from some members"
							aria-label="Sealed — hidden from some members"
							class="contents"
						>
							<Lock class="h-3 w-3 shrink-0" style="color: var(--seal)" />
						</span>
					{/if}
				</div>
				<div class="mt-0.5 flex items-center gap-1.5 text-[13px]" style="color: var(--ink-3)">
					{#if p.categoryIcon}<span>{p.categoryIcon}</span>{/if}
					<span>{p.requesterName}</span>
					<span>· {fmtDate(p.at)}</span>
					{#if p.state === 'pending_approval' && p.waitingDays > 0}
						<span style={p.stale ? 'color: var(--pending)' : ''}
							>· {p.waitingDays}d{p.stale ? ' · stale' : ''}</span
						>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 flex-col items-end gap-0.5">
				<Money minor={p.amountMinor} currency={p.currency} class="text-[16px] font-semibold" />
				{#if p.state !== 'completed' && stateLabel[p.state]}
					<span
						class="text-[10px] font-semibold tracking-[0.04em] uppercase"
						style="color: var({stateVar[p.state]})">{stateLabel[p.state]}</span
					>
				{/if}
			</div>
		</a>
	</div>
{/snippet}

{#snippet runwayLine(label: string, minor: bigint, kind: 'add' | 'sub' | 'total')}
	<div class="flex items-center justify-between {kind === 'total' ? '' : 'mt-1.5'}">
		<span style="color: {kind === 'total' ? 'var(--ink)' : 'var(--ink-3)'}">{label}</span>
		<span
			class="num {kind === 'total' ? 'font-semibold' : ''}"
			style="color: {kind === 'total'
				? minor < 0n
					? 'var(--deny)'
					: 'var(--ink)'
				: kind === 'add'
					? 'var(--ink)'
					: 'var(--ink-3)'}"
		>
			{kind === 'add' ? '+' : kind === 'sub' ? '−' : ''}{formatMinor(minor, data.currency)}
		</span>
	</div>
{/snippet}

<div>
	{#if showForecast}
		<!-- Harmony's headline: the money that's actually free this month. Live —
		     pending reserves it, sleeping releases it, approving commits it. -->
		<div class="card mb-5 p-5">
			<button
				type="button"
				onclick={() => (showRunway = !showRunway)}
				class="press -m-1 flex w-full items-start justify-between gap-3 p-1 text-left"
				aria-expanded={showRunway}
				aria-label={showRunway ? 'Hide the runway' : 'Show how this is calculated'}
			>
				<div class="min-w-0">
					<p class="section-label">Safe to spend · through {monthEndLabel()}</p>
					<div
						class="mt-1.5 font-[family-name:var(--font-display)] text-[42px] leading-[0.95] font-semibold"
						style="color: {f.freeMinor < 0n ? 'var(--deny)' : 'var(--ink)'}"
					>
						<Money minor={f.freeMinor} currency={data.currency} />
					</div>
				</div>
				<ChevronDown
					class="mt-0.5 h-5 w-5 shrink-0 transition-transform duration-200 {showRunway
						? 'rotate-180'
						: ''}"
					style="color: var(--ink-3)"
				/>
			</button>
			<!-- Harmony's read: always present, the story above the numbers. -->
			<p class="mt-2 flex items-start gap-1.5 text-[13px] leading-snug" style="color: {narrationColor}">
				<Sparkles class="mt-[3px] h-3.5 w-3.5 shrink-0" />
				<span>{narration.text}</span>
			</p>
			{#if showRunway}
				<!-- The runway: how income becomes the free number, line by line. -->
				<div
					class="mt-4 border-t pt-3 text-[14px]"
					style="border-color: var(--hairline)"
					transition:slide={{ duration: 220 }}
				>
					{@render runwayLine('Income', f.breakdown.incomeMinor, 'add')}
					{@render runwayLine('Recurring', f.breakdown.upcomingBillsMinor, 'sub')}
					{@render runwayLine('Saved', f.breakdown.savingsMinor, 'sub')}
					{@render runwayLine('Approved', f.breakdown.cashCommittedMinor, 'sub')}
					{@render runwayLine('Spent', f.breakdown.cashSpentMinor, 'sub')}
					<div class="mt-2 border-t pt-2" style="border-color: var(--hairline)">
						{@render runwayLine('Free to spend', f.freeMinor, 'total')}
					</div>
					{#if f.breakdown.reservedMinor > 0n}
						<div class="mt-2.5 flex items-center justify-between" style="color: var(--ink-3)">
							<span>Reserved for pending</span>
							<span class="num" style="color: var(--pending)"
								>−{formatMinor(f.breakdown.reservedMinor, data.currency)}</span
							>
						</div>
						<div class="flex items-center justify-between" style="color: var(--ink-3)">
							<span>If all approved</span>
							<span
								class="num"
								style="color: {f.afterReservedMinor < 0n ? 'var(--pending)' : 'var(--ink-2)'}"
								>{formatMinor(f.afterReservedMinor, data.currency)}</span
							>
						</div>
					{/if}
					{#if f.breakdown.sleepingMinor > 0n}
						<div
							class="mt-1 flex items-center justify-between gap-1.5"
							style="color: var(--seal)"
						>
							<span class="flex items-center gap-1.5"><Moon class="h-3.5 w-3.5" /> Sleeping</span>
							<span class="num">{formatMinor(f.breakdown.sleepingMinor, data.currency)}</span>
						</div>
					{/if}
					{#if f.breakdown.budgetRemainingMinor !== null}
						<div class="mt-1 flex items-center justify-between" style="color: var(--ink-3)">
							<span>Left in your budget</span>
							<span
								class="num"
								style="color: {f.breakdown.budgetRemainingMinor < 0n
									? 'var(--pending)'
									: 'var(--ink-2)'}">{formatMinor(f.breakdown.budgetRemainingMinor, data.currency)}</span
							>
						</div>
					{/if}
				</div>
			{/if}
			{#if !showRunway}
				<p class="mt-2 text-[13px]" style="color: var(--ink-3)">
					<span class="num">{formatMinor(f.breakdown.upcomingBillsMinor, data.currency)}</span> bills ·
					<span class="num">{formatMinor(f.breakdown.savingsMinor, data.currency)}</span> saved{f
						.breakdown.cashCommittedMinor > 0n
						? ` · ${formatMinor(f.breakdown.cashCommittedMinor, data.currency)} approved`
						: ''} this month
				</p>
				{#if f.breakdown.sleepingMinor > 0n}
					<p class="mt-1 flex items-center gap-1.5 text-[13px]" style="color: var(--seal)">
						<Moon class="h-3.5 w-3.5" />
						<span
							><span class="num">{formatMinor(f.breakdown.sleepingMinor, data.currency)}</span> sleeping
							on the horizon</span
						>
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="flex items-end justify-between px-1 pt-1 pb-2">
		<h1>Ledger</h1>
		<span class="num pb-1 text-[13px]" style="color: var(--ink-3)"
			>{filtered.length}
			{filtered.length === 1 ? 'item' : 'items'}</span
		>
	</div>

	<div class="mb-5 flex gap-2">
		<label class="relative flex-1">
			<span class="sr-only">Search the ledger</span>
			<Search
				class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
				style="color: var(--ink-3)"
			/>
			<input
				type="text"
				placeholder="Search the ledger..."
				bind:value={search}
				oninput={onSearchInput}
				class="field pr-10 pl-10 text-[16px]"
			/>
			{#if search}
				<button
					onclick={clearSearch}
					class="press absolute top-1/2 right-3 -translate-y-1/2"
					style="color: var(--ink-3)"
					aria-label="Clear"
				>
					<X class="h-4 w-4" />
				</button>
			{/if}
		</label>
		<button
			onclick={() => (showFilter = !showFilter)}
			class="press relative flex h-[45px] w-[45px] shrink-0 items-center justify-center rounded-[var(--r-sm)]"
			style="box-shadow: inset 0 0 0 1px {category
				? 'var(--hairline-strong)'
				: 'var(--hairline)'}; background: var(--surface)"
			aria-label="Filter the ledger"
		>
			<Funnel class="h-4 w-4" style="color: {hasFilters ? 'var(--ink)' : 'var(--ink-4)'}" />
			{#if hasFilters}
				<span
					class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
					style="background: var(--ws-accent)"
				></span>
			{/if}
		</button>
	</div>

	{#if hasFilters}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			{#each activeFilters as f (f.key)}
				<button
					onclick={() => navigateWith(f.clear)}
					class="press flex items-center gap-1.5 rounded-[var(--r-full)] py-1.5 pr-2.5 pl-3 text-[13px]"
					style="background: var(--surface-2); color: var(--ink-2)"
					aria-label="Remove filter: {f.label}"
				>
					{f.label}
					<X class="h-3 w-3" style="color: var(--ink-4)" />
				</button>
			{/each}
			{#if activeFilters.length > 1}
				<button
					onclick={clearFilters}
					class="press px-1 text-[13px] underline underline-offset-2"
					style="color: var(--ink-3)">Clear all</button
				>
			{/if}
		</div>
	{/if}

	{#if showFilter}
		<!-- Centered modal, mirroring the intelligence palette — a made object, not
			a settings dropdown. Chips commit a filter on tap; the panel stays open so
			you can stack a date, a member and a category in one visit. -->
		<div
			class="fixed inset-0 z-50"
			style="background: var(--scrim)"
			use:dismiss={() => (showFilter = false)}
			transition:fade={{ duration: 140 }}
		></div>
		<div
			class="fixed inset-x-4 top-[10vh] z-50 mx-auto flex max-h-[80vh] max-w-md flex-col"
			role="dialog"
			aria-modal="true"
			aria-label="Filter the ledger"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') showFilter = false;
			}}
			transition:scale={{ start: 0.96, duration: 170 }}
		>
			<div
				class="card-lg flex min-h-0 flex-col overflow-hidden"
				style="box-shadow: var(--shadow-float); background: var(--surface)"
			>
				<!-- Masthead header -->
				<div class="flex items-center justify-between px-5 pt-4 pb-3.5">
					<h2 class="font-[family-name:var(--font-display)] text-[22px]" style="color: var(--ink)">
						Filter
					</h2>
					<button
						onclick={() => (showFilter = false)}
						class="press -mr-1 flex h-8 w-8 items-center justify-center rounded-full"
						style="color: var(--ink-3)"
						aria-label="Close"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="h-px" style="background: var(--hairline)"></div>

				<!-- Scrollable body -->
				<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					<!-- Date range -->
					<div>
						<p class="section-label mb-2">Date range</p>
						<div class="flex items-center gap-2">
							<label class="flex-1">
								<span class="sr-only">From date</span>
								<input
									type="date"
									value={from}
									max={to || undefined}
									onchange={(e) => setRange({ from: e.currentTarget.value })}
									class="field text-[14px]"
								/>
							</label>
							<span class="text-[13px]" style="color: var(--ink-3)">to</span>
							<label class="flex-1">
								<span class="sr-only">To date</span>
								<input
									type="date"
									value={to}
									min={from || undefined}
									onchange={(e) => setRange({ to: e.currentTarget.value })}
									class="field text-[14px]"
								/>
							</label>
						</div>
					</div>

					<!-- Member -->
					{#if data.members.length > 1}
						<div>
							<p class="section-label mb-2">Member</p>
							<div class="flex flex-wrap gap-2">
								<button
									onclick={() => pickMember('')}
									role="radio"
									aria-checked={!member}
									class="press chip-btn"
									style={!member ? SELECTED : UNSELECTED}>Anyone</button
								>
								{#each data.members as m (m.id)}
									{@const on = member === m.id}
									<button
										onclick={() => pickMember(m.id)}
										role="radio"
										aria-checked={on}
										class="press chip-btn"
										style={on ? SELECTED : UNSELECTED}>{m.name}</button
									>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Category -->
					<div>
						<p class="section-label mb-2">Category</p>
						<div class="flex flex-wrap gap-2">
							<button
								onclick={() => pickCategory('')}
								role="radio"
								aria-checked={!category}
								class="press chip-btn"
								style={!category ? SELECTED : UNSELECTED}>All</button
							>
							{#each data.categories as c (c.id)}
								{@const on = category === c.id}
								<button
									onclick={() => pickCategory(c.id)}
									role="radio"
									aria-checked={on}
									class="press chip-btn"
									style={on ? SELECTED : UNSELECTED}>{c.icon} {c.name}</button
								>
							{/each}
							<button
								onclick={() => pickCategory(NO_CATEGORY)}
								role="radio"
								aria-checked={category === NO_CATEGORY}
								class="press chip-btn"
								style={category === NO_CATEGORY ? SELECTED : UNSELECTED}>Other</button
							>
						</div>
					</div>

					<!-- Bucket activity toggle -->
					<div class="h-px" style="background: var(--hairline)"></div>
					<button
						onclick={toggleMovements}
						role="switch"
						aria-checked={data.includeMovements}
						class="press flex w-full items-center justify-between"
					>
						<span class="text-left">
							<span class="block text-[15px]" style="color: var(--ink)">Bucket activity</span>
							<span class="block text-[13px]" style="color: var(--ink-3)"
								>Show money moving in and out of buckets</span
							>
						</span>
						<span
							class="relative h-[28px] w-[44px] shrink-0 rounded-full transition-colors"
							style="background: {data.includeMovements ? 'var(--accent)' : 'var(--surface-hi)'}"
						>
							<span
								class="absolute top-1 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
								style="transform: translateX({data.includeMovements ? '20px' : '4px'})"
							></span>
						</span>
					</button>
				</div>

				<!-- Footer -->
				<div class="h-px" style="background: var(--hairline)"></div>
				<div class="flex items-center justify-between px-5 py-3">
					<button
						onclick={clearFilters}
						disabled={!hasFilters}
						class="press text-[14px] disabled:opacity-40"
						style="color: var(--ink-3)">Clear all</button
					>
					<button onclick={() => (showFilter = false)} class="btn btn-accent px-5 py-2 text-[14px]"
						>Done</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if filtered.length === 0}
		<div class="mt-6 px-6 py-10 text-center">
			<div
				class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px]"
				style="background: radial-gradient(120% 120% at 30% 20%, color-mix(in oklab, var(--ws-accent) 40%, var(--surface)), var(--surface))"
			>
				<ShoppingBag
					class="h-8 w-8"
					style="color: color-mix(in oklab, var(--ws-accent) 80%, white)"
				/>
			</div>
			<p class="text-[19px] font-semibold" style="color: var(--ink)">
				{activeQuery || hasFilters ? 'No matches' : 'Nothing here yet'}
			</p>
			{#if activeQuery || hasFilters}
				<p
					class="mx-auto mt-1.5 max-w-[28ch] text-[15px] leading-relaxed"
					style="color: var(--ink-3)"
				>
					Try adjusting your search or filter.
				</p>
			{:else}
				<p
					class="mx-auto mt-1.5 max-w-[28ch] text-[15px] leading-relaxed"
					style="color: var(--ink-3)"
				>
					Log something you bought, or ask for approval before you spend.
				</p>
			{/if}
			<a href="/w/{slug}/purchases/new" class="btn btn-accent mt-6">New purchase</a>
			{#if !activeQuery && !hasFilters}
				<!-- Empty states are the teaching moment: you're here precisely
				     because you haven't done the thing yet. -->
				<a
					href="/w/{slug}/settings/help?s=logging"
					class="press mt-4 flex items-center justify-center gap-1.5 text-[14px] font-medium"
					style="color: var(--ws-accent)"
				>
					<CircleHelp class="h-4 w-4" /> How this works
				</a>
			{/if}
		</div>
	{:else}
		{#if pending.length > 0}
			<p class="section-label mt-2 mb-1 px-1" style="color: var(--pending)">
				Awaiting a decision · {pending.length}
			</p>
			<div class="mb-6">
				{#each pending as p, i (p.id)}
					{@render row(p, i === pending.length - 1)}
				{/each}
			</div>
		{/if}

		{#if showConfirm}
			<!-- Green like the APPROVED chip these rows carry: greenlit, they just
			     need the real amount recorded. -->
			<p class="section-label mt-2 mb-1 px-1" style="color: var(--approve)">
				Confirm what you paid · {confirmItems.length}
			</p>
			<div class="mb-6">
				{#each confirmItems as p, i (p.id)}
					{@render row(p, i === confirmItems.length - 1)}
				{/each}
			</div>
		{/if}

		{#if showSleeping}
			<!-- Seal-purple: the temporal-lock tone shared with sealed gifts. -->
			<p class="section-label mt-2 mb-1 px-1" style="color: var(--seal)">
				Sleeping on it · {sleepingItems.length}
			</p>
			<div class="mb-6">
				{#each sleepingItems as p, i (p.id)}
					<a
						href="/w/{slug}/purchases/{p.id}"
						class="press flex items-center gap-3 px-1 py-3 {i === sleepingItems.length - 1
							? ''
							: 'hairline'}"
					>
						<span
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
							style="background: color-mix(in oklab, var(--seal) 13%, var(--surface-2)); color: var(--seal)"
						>
							<Moon class="h-[18px] w-[18px]" />
						</span>
						<div class="min-w-0 flex-1">
							<span class="block truncate text-[16px] font-medium" style="color: var(--ink)"
								>{p.itemName}</span
							>
							<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)"
								>{p.requesterName}</span
							>
						</div>
						<div class="flex shrink-0 flex-col items-end gap-1">
							<Money
								minor={p.amountMinor}
								currency={p.currency}
								class="text-[16px] font-semibold"
							/>
							<span
								class="chip num"
								style="color: color-mix(in oklab, var(--seal) 80%, var(--ink)); background: color-mix(in oklab, var(--seal) 13%, var(--surface))"
								>{heldLeft(p.heldUntil)}</span
							>
						</div>
					</a>
				{/each}
			</div>
		{/if}

		{#if rest.length > 0}
			<p class="section-label mb-1 px-1">Recent</p>
			<div>
				{#each rest as e, i (e.id)}
					{#if e.kind === 'movement'}
						{@render movementRow(e, i === rest.length - 1)}
					{:else}
						{@render row(e, i === rest.length - 1)}
					{/if}
				{/each}
			</div>
		{/if}
		{#if hasMore}
			<button
				onclick={loadMore}
				disabled={loadingMore}
				class="btn btn-ghost mt-3 w-full py-3 text-[15px]"
			>
				{loadingMore ? 'Loading...' : 'Show more'}
			</button>
		{/if}
	{/if}
</div>

<style>
	/* Filter chips: rounded, tactile, quick state transition. Selected/unselected
	   colors are set inline (SELECTED/UNSELECTED) so the same class serves both. */
	.chip-btn {
		border-radius: var(--r-full);
		padding: 0.5rem 0.85rem;
		font-size: 14px;
		line-height: 1.1;
		transition:
			background 0.12s ease,
			color 0.12s ease,
			box-shadow 0.12s ease;
	}
</style>
