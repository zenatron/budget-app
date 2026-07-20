<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { goto } from '$app/navigation';
	import { formatMinor } from '$lib/money-format';
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

	function pickCategory(id: string) {
		showFilter = false;
		void navigateWith({ category: id });
	}

	function pickMember(id: string) {
		showFilter = false;
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
		showFilter = false;
		void navigateWith({ category: '', member: '', from: '', to: '', basis: '' });
	}

	/** Reloads from the server: it changes what gets paged over, not just shown. */
	function toggleMovements() {
		showFilter = false;
		void navigateWith({ movements: data.includeMovements ? '' : '1' });
	}

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
		cancelled: '--ink-4',
		draft: '--ink-4'
	};
	const stateLabel: Record<string, string> = {
		pending_approval: 'Pending',
		approved: 'Approved',
		denied: 'Denied',
		refunded: 'Refunded',
		cancelled: 'Cancelled',
		draft: 'Draft'
	};

	type P = Extract<Entry, { kind: 'purchase' }>;
	const pending = $derived(
		filtered.filter((e): e is P => isPurchase(e) && e.state === 'pending_approval')
	);

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
	const rest = $derived(
		filtered.filter((e) => {
			if (isPurchase(e) && e.state === 'pending_approval') return false;
			if (showConfirm && isPurchase(e) && e.state === 'approved' && e.mine) return false;
			return true;
		})
	);

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
			<Icon name="bank" class="h-[16px] w-[16px]" style="color: {m.bucketColor ?? 'var(--seal)'}" />
		</span>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[15px]" style="color: var(--ink-2)">
				{m.type === 'accrual' ? 'Set aside' : m.type === 'withdrawal' ? 'Taken from' : 'Adjusted'}
				{m.bucketName}
			</p>
			<p class="mt-0.5 text-[13px]" style="color: var(--ink-4)">
				{m.note ?? 'Bucket'} · {fmtDate(m.at)}
			</p>
		</div>
		<span class="num shrink-0 text-[15px]" style="color: var(--ink-3)">
			{m.amountMinor >= 0n ? '+' : ''}{formatMinor(m.amountMinor, m.currency)}
		</span>
	</a>
{/snippet}

{#snippet row(p: P, last: boolean)}
	<a
		href="/w/{slug}/purchases/{p.id}"
		class="press flex items-center gap-3 px-1 py-3 {last ? '' : 'hairline'}"
		style="view-transition-name: vt-card-{p.id}"
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
						<Icon name="reverse" class="h-[18px] w-[18px] text-white drop-shadow" />
					</span>
				{/if}
			</span>
		{:else}
			<span
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[18px]"
				style="background: var(--surface-2); box-shadow: inset 0 0 0 0.5px var(--hairline)"
			>
				<Icon
					name={p.isRefund ? 'reverse' : 'bag'}
					class="h-[18px] w-[18px]"
					style="color: var(--ink-4)"
				/>
			</span>
		{/if}
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="truncate text-[16px] font-medium" style="color: var(--ink)">{p.itemName}</span>
				{#if p.sealed}
					<span
						role="img"
						title="Sealed — hidden from some members"
						aria-label="Sealed — hidden from some members"
						class="contents"
					>
						<Icon name="lock" class="h-3 w-3 shrink-0" style="color: var(--seal)" />
					</span>
				{/if}
			</div>
			<div class="mt-0.5 flex items-center gap-1.5 text-[13px]" style="color: var(--ink-4)">
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
{/snippet}

<div>
	<div class="flex items-end justify-between px-1 pt-1 pb-2">
		<h1>Ledger</h1>
		<span class="num pb-1 text-[13px]" style="color: var(--ink-4)"
			>{filtered.length}
			{filtered.length === 1 ? 'item' : 'items'}</span
		>
	</div>

	<div class="mb-5 flex gap-2">
		<label class="relative flex-1">
			<span class="sr-only">Search the ledger</span>
			<Icon
				name="search"
				class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
				style="color: var(--ink-4)"
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
					style="color: var(--ink-4)"
					aria-label="Clear"
				>
					<Icon name="xmark" class="h-4 w-4" />
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
			<Icon
				name="funnel"
				class="h-4 w-4"
				style="color: {hasFilters ? 'var(--ink)' : 'var(--ink-4)'}"
			/>
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
					<Icon name="xmark" class="h-3 w-3" style="color: var(--ink-4)" />
				</button>
			{/each}
			{#if activeFilters.length > 1}
				<button
					onclick={clearFilters}
					class="press px-1 text-[13px] underline underline-offset-2"
					style="color: var(--ink-4)">Clear all</button
				>
			{/if}
		</div>
	{/if}

	{#if showFilter}
		<div class="fixed inset-0 z-30" use:dismiss={() => (showFilter = false)}></div>
		<!--
			Scrolls rather than grows: with a date range, every member and every
			category it is taller than a phone, and a menu that runs off the bottom
			of the screen hides the rows you opened it to reach.
		-->
		<div
			class="card-lg absolute right-4 z-40 mt-1 max-h-[70vh] w-72 overflow-y-auto p-1.5"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
			role="menu"
		>
			<!--
				A checkmark, not a pill or a switch: this is a menu, so the row commits
				on tap like every category below it. It used to carry a "Shown"/"Hidden"
				caption *and* the tick — the state said twice, once in words that changed
				under your thumb as you tapped.
			-->
			<button
				onclick={toggleMovements}
				role="menuitemcheckbox"
				aria-checked={data.includeMovements}
				class="press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
			>
				<span style="color: var(--ink)">Bucket activity</span>
				<Icon
					name="checkmark"
					class="ml-auto h-4 w-4 shrink-0 {data.includeMovements ? '' : 'invisible'}"
					style="color: var(--ink)"
				/>
			</button>
			<div class="my-1 h-px" style="background: var(--hairline)"></div>

			<p class="section-label px-3 pt-2 pb-1.5">Date range</p>
			<div class="flex items-center gap-2 px-3 pb-2">
				<label class="flex-1">
					<span class="sr-only">From date</span>
					<input
						type="date"
						value={from}
						max={to || undefined}
						onchange={(e) => setRange({ from: e.currentTarget.value })}
						class="field px-2 py-1.5 text-[13px]"
					/>
				</label>
				<span class="text-[13px]" style="color: var(--ink-4)">to</span>
				<label class="flex-1">
					<span class="sr-only">To date</span>
					<input
						type="date"
						value={to}
						min={from || undefined}
						onchange={(e) => setRange({ to: e.currentTarget.value })}
						class="field px-2 py-1.5 text-[13px]"
					/>
				</label>
			</div>

			{#if data.members.length > 1}
				<div class="my-1 h-px" style="background: var(--hairline)"></div>
				<p class="section-label px-3 pt-2 pb-1">Member</p>
				<button
					onclick={() => pickMember('')}
					role="menuitemradio"
					aria-checked={!member}
					class="press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
					style={!member ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
				>
					<span style="color: var(--ink)">Anyone</span>
					<Icon
						name="checkmark"
						class="ml-auto h-4 w-4 shrink-0 {member ? 'invisible' : ''}"
						style="color: var(--ink)"
					/>
				</button>
				{#each data.members as m (m.id)}
					<button
						onclick={() => pickMember(m.id)}
						role="menuitemradio"
						aria-checked={member === m.id}
						class="press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
						style={member === m.id ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
					>
						<span style="color: var(--ink)">{m.name}</span>
						<Icon
							name="checkmark"
							class="ml-auto h-4 w-4 shrink-0 {member === m.id ? '' : 'invisible'}"
							style="color: var(--ink)"
						/>
					</button>
				{/each}
			{/if}

			<div class="my-1 h-px" style="background: var(--hairline)"></div>
			<p class="section-label px-3 pt-2 pb-1">Category</p>
			<button
				onclick={() => pickCategory('')}
				role="menuitemradio"
				aria-checked={!category}
				class="press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
				style={!category ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
			>
				<span style="color: var(--ink)">All categories</span>
				{#if !category}
					<Icon name="checkmark" class="ml-auto h-4 w-4" style="color: var(--ink)" />
				{/if}
			</button>
			{#each data.categories as c (c.id)}
				<button
					onclick={() => pickCategory(c.id)}
					role="menuitemradio"
					aria-checked={category === c.id}
					class="press flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
					style={category === c.id ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
				>
					<span style="color: var(--ink)">{c.icon} {c.name}</span>
					<Icon
						name="checkmark"
						class="ml-auto h-4 w-4 shrink-0 {category === c.id ? '' : 'invisible'}"
						style="color: var(--ink)"
					/>
				</button>
			{/each}
			<!-- The rows with no category at all — what analytics totals as "Other". -->
			<button
				onclick={() => pickCategory(NO_CATEGORY)}
				role="menuitemradio"
				aria-checked={category === NO_CATEGORY}
				class="press flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
				style={category === NO_CATEGORY ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
			>
				<span style="color: var(--ink)">Other</span>
				<Icon
					name="checkmark"
					class="ml-auto h-4 w-4 shrink-0 {category === NO_CATEGORY ? '' : 'invisible'}"
					style="color: var(--ink)"
				/>
			</button>
		</div>
	{/if}

	{#if filtered.length === 0}
		<div class="mt-6 px-6 py-10 text-center">
			<div
				class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px]"
				style="background: radial-gradient(120% 120% at 30% 20%, color-mix(in oklab, var(--ws-accent) 40%, var(--surface)), var(--surface))"
			>
				<Icon
					name="bag"
					class="h-8 w-8"
					style="color: color-mix(in oklab, var(--ws-accent) 80%, white)"
				/>
			</div>
			<p class="text-[19px] font-semibold" style="color: var(--ink)">
				{activeQuery || category ? 'No matches' : 'Nothing here yet'}
			</p>
			{#if activeQuery || category}
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
			{#if !activeQuery && !category}
				<!-- Empty states are the teaching moment: you're here precisely
				     because you haven't done the thing yet. -->
				<a
					href="/w/{slug}/settings/help?s=logging"
					class="press mt-4 flex items-center justify-center gap-1.5 text-[14px] font-medium"
					style="color: var(--ws-accent)"
				>
					<Icon name="question" class="h-4 w-4" /> How this works
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
