<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { goto } from '$app/navigation';
	import { formatMinor } from '$lib/money-format';
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
	const activeQuery = $derived(page.url.searchParams.get('q') ?? '');
	let showFilter = $state(false);
	let loadingMore = $state(false);

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
	const rest = $derived(filtered.filter((e) => !isPurchase(e) || e.state !== 'pending_approval'));

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		try {
			// Plain string: this is a one-shot fetch URL, not reactive state. It has
			// to carry the same filters the page was loaded with, or "Show more"
			// would append rows from an unfiltered query.
			const qs =
				`offset=${items.length}` +
				(data.includeMovements ? '&movements=1' : '') +
				(activeQuery ? `&q=${encodeURIComponent(activeQuery)}` : '') +
				(category ? `&category=${encodeURIComponent(category)}` : '');
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
				<img
					src="/w/{slug}/blobs/{p.thumbBlobId}"
					alt=""
					class="h-10 w-10 rounded-[12px] object-cover"
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
				<span>· {fmtDate(p.createdAt)}</span>
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
			aria-label="Filter by category"
		>
			<Icon
				name="funnel"
				class="h-4 w-4"
				style="color: {category ? 'var(--ink)' : 'var(--ink-4)'}"
			/>
			{#if category}
				<span
					class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
					style="background: var(--ws-accent)"
				></span>
			{/if}
		</button>
	</div>

	{#if showFilter}
		<div class="fixed inset-0 z-30" use:dismiss={() => (showFilter = false)}></div>
		<div
			class="card-lg absolute right-4 z-40 mt-1 w-56 overflow-hidden p-1.5"
			style="box-shadow: var(--shadow-float); background: var(--surface)"
			role="menu"
		>
			<button
				onclick={toggleMovements}
				class="press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
			>
				<span style="color: var(--ink)">Bucket activity</span>
				<span class="ml-auto text-[13px]" style="color: var(--ink-4)">
					{data.includeMovements ? 'Shown' : 'Hidden'}
				</span>
				{#if data.includeMovements}
					<Icon name="checkmark" class="h-4 w-4" style="color: var(--ink)" />
				{/if}
			</button>
			<div class="my-1 h-px" style="background: var(--hairline)"></div>
			<button
				onclick={() => pickCategory('')}
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
					class="press flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[15px]"
					style={category === c.id ? 'background: oklch(0.28 0.03 65 / 0.06)' : ''}
				>
					<span style="color: var(--ink)">{c.icon} {c.name}</span>
					{#if category === c.id}
						<Icon name="checkmark" class="ml-auto h-4 w-4" style="color: var(--ink)" />
					{/if}
				</button>
			{/each}
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
