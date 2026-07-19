<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import { dismiss } from '$lib/actions/dismiss';
	import { toastError } from '$lib/toast-state.svelte';
	let { data } = $props();
	let slug = $derived(page.params.workspace);

	let search = $state('');
	let category = $state('');
	let showFilter = $state(false);
	let loadingMore = $state(false);

	let items = $state<typeof data.purchases>([]);
	let hasMore = $state(false);

	// Re-seed from the server list whenever it changes, not just on first paint.
	// An SSE invalidation refreshes `data` but the paginated `items` array is
	// what renders, so gating on `items.length === 0` froze the list on stale
	// rows after any live update.
	$effect(() => {
		items = [...data.purchases];
		hasMore = data.hasMore;
	});

	let filtered = $derived.by(() => {
		let result = items;
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(
				(p) =>
					p.itemName.toLowerCase().includes(q) ||
					(p.merchantName && p.merchantName.toLowerCase().includes(q))
			);
		}
		if (category) {
			result = result.filter((p) => p.categoryId === category);
		}
		return result;
	});

	function clearSearch() {
		search = '';
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

	type P = (typeof items)[number];
	const pending = $derived(filtered.filter((p: P) => p.state === 'pending_approval'));
	const rest = $derived(filtered.filter((p: P) => p.state !== 'pending_approval'));

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		try {
			const res = await fetch(`/w/${slug}/purchases/data?offset=${items.length}`);
			if (!res.ok) throw new Error(String(res.status));
			const json = await res.json();
			items = [...items, ...json.purchases];
			hasMore = json.hasMore;
		} catch {
			// Failing silently left "Show more" looking like a no-op button.
			toastError("Couldn't load more purchases");
		}
		loadingMore = false;
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

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
		<h1>Wallet</h1>
		<span class="num pb-1 text-[13px]" style="color: var(--ink-4)"
			>{filtered.length}
			{filtered.length === 1 ? 'item' : 'items'}</span
		>
	</div>

	<div class="mb-5 flex gap-2">
		<label class="relative flex-1">
			<span class="sr-only">Search purchases</span>
			<Icon
				name="search"
				class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
				style="color: var(--ink-4)"
			/>
			<input
				type="text"
				placeholder="Search purchases..."
				bind:value={search}
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
				onclick={() => {
					category = '';
					showFilter = false;
				}}
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
					onclick={() => {
						category = c.id;
						showFilter = false;
					}}
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
				{search || category ? 'No matches' : 'Nothing here yet'}
			</p>
			{#if search || category}
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
				{#each rest as p, i (p.id)}
					{@render row(p, i === rest.length - 1)}
				{/each}
			</div>
		{/if}
		{#if hasMore && !search && !category}
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
