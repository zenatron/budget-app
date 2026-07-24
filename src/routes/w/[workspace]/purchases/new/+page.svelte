<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import {
		ArrowRight,
		Calendar,
		Camera,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		Clock,
		CreditCard,
		Gift,
		Landmark,
		MapPin,
		Moon,
		Search,
		ShoppingBag,
		Sparkles,
		X
	} from '@lucide/svelte';
	import { money } from '$lib/actions/money';
	import { onDestroy, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { calDateInZone } from '$lib/domain/time/zoned';
	import { dismiss } from '$lib/actions/dismiss';

	import BillImport from '$lib/components/BillImport.svelte';
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
	import HoldPicker from '$lib/components/HoldPicker.svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	let showGift = $state(false);
	let photoPreview: string | null = $state(null);
	// "Sleep on it" at creation: opens the duration picker, then submits the form
	// as a request that's immediately put to sleep.
	let showSleep = $state(false);
	let sleepDays = $state(3);

	// Bound so the bill importer can fill them. Everything else on this form
	// stays uncontrolled — these three are the only fields a bill can speak to.
	let amount = $state('');
	let itemName = $state('');
	let merchantName = $state('');
	let photoInput: HTMLInputElement | null = $state(null);

	// Optional category suggestion (the assist layer's first proving ground).
	// Bound so a suggestion can fill it; a suggestion is only ever offered, never
	// applied — the person taps Apply. With AI off, none of this runs.
	let categoryId = $state('');
	let suggested = $state<{ id: string; name: string; icon: string | null } | null>(null);
	let suggesting = $state(false);
	let lastSuggestKey = '';

	async function suggestCategory() {
		if (!data.harmonyEnabled) return;
		const item = itemName.trim();
		if (!item || categoryId) {
			suggested = null;
			return;
		}
		const key = `${item}|${merchantName.trim()}`;
		if (key === lastSuggestKey) return; // already asked about this exact text
		lastSuggestKey = key;
		suggesting = true;
		suggested = null;
		try {
			const res = await fetch(`/w/${slug}/purchases/suggest-category`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemName: item, merchantName: merchantName.trim() })
			});
			if (res.ok) {
				const d = await res.json();
				if (d.categoryId && d.categoryId !== categoryId) {
					suggested = { id: d.categoryId, name: d.name, icon: d.icon };
				}
			}
		} catch {
			// Any failure just means no suggestion — the form is unchanged.
		} finally {
			suggesting = false;
		}
	}

	function applySuggestion() {
		if (suggested) {
			categoryId = suggested.id;
			suggested = null;
		}
	}

	// Natural-language entry: a sentence (typed, or dictated with the phone's own
	// keyboard mic) parsed into the fields below. Money and date are extracted
	// deterministically on the server; only the category may come from the assist.
	// Everything lands as editable fields — you still tap Log it / Ask first.
	let describeText = $state('');
	let parsing = $state(false);

	async function parseDescription() {
		const text = describeText.trim();
		if (!text || parsing) return;
		parsing = true;
		try {
			const res = await fetch(`/w/${slug}/purchases/parse`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text })
			});
			if (res.ok) {
				const d = await res.json();
				if (!d.empty) {
					if (d.amount) amount = d.amount;
					if (d.itemName) itemName = d.itemName;
					if (d.merchantName) merchantName = d.merchantName;
					if (d.spentAt) spentAt = d.spentAt;
					if (d.categoryId) {
						categoryId = d.categoryId;
						suggested = null;
						lastSuggestKey = `${itemName}|${merchantName}`; // don't re-ask on blur
					}
				}
			}
		} catch {
			// Leave the form untouched; the person can fill it by hand.
		} finally {
			parsing = false;
		}
	}

	// The Harmony button's "log a purchase" door hands off here via ?describe=.
	onMount(() => {
		const d = page.url.searchParams.get('describe');
		if (d) {
			describeText = d;
			void parseDescription();
		}
	});
	const amountMinorForPicker = $derived(
		BigInt(Math.round((Number((amount || '0').replace(/[^0-9.]/g, '')) || 0) * 100))
	);

	/**
	 * Hand the rendered page to the form's own photo input rather than uploading
	 * it separately: it then travels as an ordinary image through the pipeline
	 * that already sniffs magic bytes, caps pixels and strips metadata. A
	 * DataTransfer is the only way to set an input's files programmatically.
	 */
	let scanning = $state(false);

	/**
	 * Stage one hands back the digits, nothing more. It goes in the item field so
	 * it is visible and editable rather than hidden in a form value — you are
	 * expected to type over it with what the thing actually is, and a barcode you
	 * can see is at least a record of what you scanned.
	 */
	function applyScan(hit: { value: string; format: string }) {
		scanning = false;
		if (!itemName) itemName = hit.value;
	}

	/** Nothing read: keep the frame as the photo, which says more than digits. */
	function applyScanPhoto(file: File) {
		attachImage(file);
	}

	function attachImage(file: File) {
		if (!photoInput) return;
		const dt = new DataTransfer();
		dt.items.add(file);
		photoInput.files = dt.files;
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoPreview = URL.createObjectURL(file);
	}

	function applyBill(v: { amount: string; vendor: string | null; image: File | null }) {
		amount = v.amount;
		if (v.vendor) {
			if (!merchantName) merchantName = v.vendor;
			if (!itemName) itemName = `${v.vendor} bill`;
		}
		if (v.image) attachImage(v.image);
	}
	const symbol = $derived(
		(0)
			.toLocaleString(undefined, { style: 'currency', currency: data.workspace.currency })
			.replace(/[\d.,\s]/g, '')
	);

	// Seal window, in the workspace's timezone. The server caps it at
	// maxSealDays, so min/max here keep the native picker inside what it accepts
	// rather than letting you choose a date that fails on submit.
	const tz = $derived(data.workspace.timezone);
	const iso = (d: { y: number; m: number; d: number }) =>
		`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
	const todayCal = $derived(calDateInZone(new Date(), tz));
	const shift = (days: number) => {
		const base = Date.UTC(todayCal.y, todayCal.m - 1, todayCal.d) + days * 86_400_000;
		const d = new Date(base);
		return iso({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
	};
	const minSeal = $derived(shift(1));
	const maxSeal = $derived(shift(data.maxSealDays));

	let sealFrom = $state<string[]>([]);
	let sealUntil = $state('');

	// When the purchase actually happened. Defaults to today and is capped there —
	// you can't have already bought something in the future. Only relevant to the
	// "Already bought" path; left at today it just means "now". This is what makes
	// that label honest: you really can log a past purchase, on its real date.
	const todayIso = $derived(iso(todayCal));
	let spentAt = $state('');
	// Seed once the timezone-derived today is known, and keep it from ever showing
	// blank/future without overriding a date the user has chosen.
	$effect(() => {
		if (!spentAt) spentAt = todayIso;
	});

	function toggleSeal(id: string) {
		sealFrom = sealFrom.includes(id) ? sealFrom.filter((x) => x !== id) : [...sealFrom, id];
	}

	const sealPresets = $derived(
		[
			{ days: 7, label: '1 week' },
			{ days: 14, label: '2 weeks' },
			{ days: 30, label: '1 month' },
			{ days: 90, label: '3 months' }
		]
			.filter((p) => p.days <= data.maxSealDays)
			.map((p) => ({ ...p, date: shift(p.days) }))
	);

	const sealSummary = $derived.by(() => {
		if (sealFrom.length === 0 || !sealUntil) return null;
		const names = data.sealableMembers
			.filter((m: { id: string }) => sealFrom.includes(m.id))
			.map((m: { displayName: string }) => m.displayName);
		const [y, m, d] = sealUntil.split('-').map(Number);
		const when = new Date(Date.UTC(y, m - 1, d));
		const days = Math.round(
			(Date.UTC(y, m - 1, d) - Date.UTC(todayCal.y, todayCal.m - 1, todayCal.d)) / 86_400_000
		);
		const on = when.toLocaleDateString(undefined, {
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		});
		return `Hidden from ${names.join(' and ')} until ${on} — ${days} day${days === 1 ? '' : 's'}.`;
	});

	function onPhoto(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoPreview = file ? URL.createObjectURL(file) : null;
	}

	onDestroy(() => {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
	});
</script>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}/purchases"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[15px]"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Ledger
	</a>

	{#if data.barcodeEnabled}
		<button
			type="button"
			onclick={() => (scanning = true)}
			class="press card flex w-full items-center gap-3 p-4 text-left"
		>
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
				style="background: color-mix(in oklab, var(--ws-accent) 14%, var(--surface))"
			>
				<Search class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-[15px] font-medium" style="color: var(--ink)">Scan a barcode</span>
					<span
						class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
						style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
						>Alpha</span
					>
				</span>
				<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)"
					>Reads the number. You still enter the price.</span
				>
			</span>
			<ChevronRight class="h-4 w-4 shrink-0" style="color: var(--ink-4)" />
		</button>

		<BarcodeScanner bind:open={scanning} onscan={applyScan} onphoto={applyScanPhoto} />
	{/if}

	{#if data.billImportEnabled}
		<BillImport currency={data.workspace.currency} dayFirst={data.dayFirst} onapply={applyBill} />
	{/if}

	<form method="POST" enctype="multipart/form-data" use:submit class="space-y-4">
		<!-- Describe it: a sentence (typed or dictated) parsed into the fields below.
		     Accent-tinted so it reads as the optional smart shortcut, not another
		     required field competing with Amount. -->
		{#if data.harmonyEnabled}
			<div
				class="card p-3"
				style="background: color-mix(in oklab, var(--ws-accent) 7%, var(--surface))"
			>
				<div class="flex items-center gap-2.5">
					<Sparkles class="h-5 w-5 shrink-0" style="color: var(--ws-accent)" />
					<input
						bind:value={describeText}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								parseDescription();
							}
						}}
						aria-label="Describe the purchase in words"
						placeholder="Describe it, or dictate"
						class="min-w-0 flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
						style="color: var(--ink)"
					/>
					<button
						type="button"
						onclick={parseDescription}
						disabled={!describeText.trim() || parsing}
						aria-label="Fill the form from your description"
						class="press grid h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30"
						style="background: var(--ws-accent); color: var(--paper)"
					>
						{#if parsing}
							<span
								class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
							></span>
						{:else}
							<ArrowRight class="h-4 w-4" />
						{/if}
					</button>
				</div>
				{#if !describeText}
					<p class="mt-2 pl-[30px] text-[12px] leading-snug" style="color: var(--ink-3)">
						Type or dictate a sentence like "23 on lunch at Chipotle yesterday". Harmony fills in
						the amount, item, and category; you confirm before saving.
					</p>
				{/if}
			</div>
		{/if}

		<!-- Amount: the focal point -->
		<div class="card-lg card px-6 py-8 text-center">
			<label class="block">
				<span class="section-label">Amount</span>
				<div class="mt-3 flex items-center justify-center">
					<span
						class="font-[family-name:var(--font-display)] text-[34px] font-semibold"
						style="color: var(--ink-3)">{symbol}</span
					>
					<input
						name="amount"
						aria-label="Amount"
						bind:value={amount}
						use:money
						required
						inputmode="decimal"
						pattern="[0-9]*\.?[0-9]*"
						placeholder="0"
						autocomplete="off"
						class="w-[6ch] border-none bg-transparent p-0 text-center font-[family-name:var(--font-display)] text-[56px] leading-none font-semibold tracking-tight tabular-nums outline-none placeholder:opacity-30"
						style="color: var(--ink)"
					/>
				</div>
			</label>
		</div>

		<div class="card p-2">
			<label class="row">
				<ShoppingBag class="h-5 w-5" style="color: var(--ink-4)" />
				<input
					name="itemName"
					aria-label="Item"
					bind:value={itemName}
					onblur={suggestCategory}
					required
					maxlength="120"
					placeholder="What did you buy?"
					class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
					style="color: var(--ink)"
				/>
			</label>
			<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
				<MapPin class="h-5 w-5" style="color: var(--ink-4)" />
				<input
					name="merchantName"
					aria-label="Merchant"
					bind:value={merchantName}
					onblur={suggestCategory}
					maxlength="200"
					placeholder="Where did you buy it?"
					class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
					style="color: var(--ink)"
				/>
			</div>
			<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
				<CreditCard class="h-5 w-5" style="color: var(--ink-4)" />
				<select
					name="categoryId"
					bind:value={categoryId}
					onchange={() => (suggested = null)}
					class="-mx-1 flex-1 border-none bg-transparent p-0 text-[17px] outline-none"
					style="color: var(--ink); appearance: none; background-image: none"
				>
					<option value="">No category</option>
					{#each data.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
				</select>
				<ChevronDown class="h-4 w-4" style="color: var(--ink-4)" />
			</div>
			{#if data.harmonyEnabled && !categoryId && (suggesting || suggested)}
				<div
					class="row hairline"
					style="box-shadow: inset 0 0.5px 0 var(--hairline)"
					transition:fade={{ duration: 120 }}
				>
					<Sparkles class="h-5 w-5" style="color: var(--ws-accent)" />
					{#if suggesting}
						<span class="flex-1 text-[15px]" style="color: var(--ink-3)">Finding a category…</span>
					{:else if suggested}
						<button
							type="button"
							onclick={applySuggestion}
							class="press flex-1 text-left text-[15px]"
							style="color: var(--ink-2)"
						>
							Suggested
							<strong style="color: var(--ink)">{suggested.icon} {suggested.name}</strong>
							<span style="color: var(--ws-accent)">· Apply</span>
						</button>
						<button
							type="button"
							onclick={() => (suggested = null)}
							aria-label="Dismiss suggestion"
							class="press"
						>
							<X class="h-4 w-4" style="color: var(--ink-4)" />
						</button>
					{/if}
				</div>
			{/if}
			{#if data.buckets.length > 0}
				<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
					<Landmark class="h-5 w-5" style="color: var(--ink-4)" />
					<select
						name="bucketId"
						class="-mx-1 flex-1 border-none bg-transparent p-0 text-[17px] outline-none"
						style="color: var(--ink); appearance: none; background-image: none"
					>
						<option value="">Charge to bucket</option>
						{#each data.buckets as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
					</select>
					<ChevronDown class="h-4 w-4" style="color: var(--ink-4)" />
				</div>
			{/if}
			<!-- Photo (optional) -->
			<label
				class="row hairline cursor-pointer"
				style="box-shadow: inset 0 0.5px 0 var(--hairline)"
			>
				{#if photoPreview}
					<img src={photoPreview} alt="" class="h-9 w-9 shrink-0 rounded-[8px] object-cover" />
					<span class="flex-1 text-[17px]" style="color: var(--ink)">Photo attached</span>
					<span class="text-[14px]" style="color: var(--ink-3)">Change</span>
				{:else}
					<Camera class="h-5 w-5" style="color: var(--ink-4)" />
					<span class="flex-1 text-[17px]" style="color: var(--ink-3)">Add a photo (optional)</span>
				{/if}
				<input
					type="file"
					name="photo"
					bind:this={photoInput}
					accept="image/jpeg,image/png,image/webp"
					class="sr-only"
					onchange={onPhoto}
				/>
			</label>
			<div class="row" style="box-shadow: inset 0 0.5px 0 var(--hairline); align-items: flex-start">
				<Clock class="mt-0.5 h-5 w-5" style="color: var(--ink-3)" />
				<textarea
					name="note"
					aria-label="Note"
					rows="1"
					maxlength="2000"
					placeholder="Add a note (optional)"
					class="flex-1 resize-none border-none bg-transparent p-0 pt-0.5 text-[16px] outline-none placeholder:opacity-40"
					style="color: var(--ink)"></textarea>
			</div>
			<!--
				Purchase date. Only used by "Already bought" — a request hasn't happened
				yet, so the server ignores it there. Capped at today; left at today it
				means "now", so the everyday case needs no interaction.
			-->
			<label class="row" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
				<Calendar class="h-5 w-5" style="color: var(--ink-4)" />
				<span class="flex-1 text-[16px]" style="color: var(--ink-3)">When</span>
				<input
					type="date"
					name="spentAt"
					aria-label="When you bought it"
					bind:value={spentAt}
					max={todayIso}
					class="border-none bg-transparent p-0 text-right text-[16px] outline-none"
					style="color: var(--ink)"
				/>
			</label>
		</div>

		{#if data.sealableMembers.length > 0}
			<div
				class="card overflow-hidden"
				style="background: color-mix(in oklab, var(--seal) 8%, var(--surface))"
			>
				<button
					type="button"
					onclick={() => (showGift = !showGift)}
					class="press flex w-full items-center gap-3 p-4 text-left"
				>
					<span
						class="flex h-9 w-9 items-center justify-center rounded-full"
						style="background: color-mix(in oklab, var(--seal) 20%, transparent)"
					>
						<Gift class="h-[18px] w-[18px]" style="color: var(--seal)" />
					</span>
					<div class="flex-1">
						<p class="text-[15px] font-semibold" style="color: var(--seal)">
							Gift mode — hide this purchase
						</p>
						<p class="text-[13px]" style="color: var(--ink-3)">
							Invisible to who you pick, including totals
						</p>
					</div>
					<ChevronDown
						class="h-4 w-4 transition-transform duration-200 {showGift ? 'rotate-180' : ''}"
						style="color: var(--seal)"
					/>
				</button>
				{#if showGift}
					<div class="space-y-4 px-4 pb-4">
						<fieldset>
							<legend class="section-label mb-2">Hide from</legend>
							<div class="flex flex-wrap gap-2">
								{#each data.sealableMembers as m (m.id)}
									{@const on = sealFrom.includes(m.id)}
									<button
										type="button"
										role="checkbox"
										aria-checked={on}
										aria-label={m.displayName}
										onclick={() => toggleSeal(m.id)}
										class="press rounded-full px-4 py-2 text-[15px] transition-colors"
										style="color: {on ? 'white' : 'var(--ink-2)'}; background: {on
											? 'var(--seal)'
											: 'var(--surface)'}; box-shadow: inset 0 0 0 1px {on
											? 'transparent'
											: 'var(--hairline)'}; font-weight: {on ? '600' : '500'}"
									>
										{m.displayName}
									</button>
									{#if on}<input type="hidden" name="sealMemberIds" value={m.id} />{/if}
								{/each}
							</div>
						</fieldset>

						<!--
							Presets do the date arithmetic. "Reveal on (max 90 days)" asked you
							to work out a date in your head, and the bare input would happily
							take one the server then rejects.
						-->
						<div>
							<span class="section-label mb-2 block" id="reveal-label">Reveal on</span>
							<div class="mb-2 flex flex-wrap gap-2">
								{#each sealPresets as p (p.days)}
									{@const on = sealUntil === p.date}
									<button
										type="button"
										onclick={() => (sealUntil = p.date)}
										class="press rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors"
										style="color: {on ? 'white' : 'var(--ink-2)'}; background: {on
											? 'var(--seal)'
											: 'var(--surface)'}; box-shadow: inset 0 0 0 1px {on
											? 'transparent'
											: 'var(--hairline)'}"
									>
										{p.label}
									</button>
								{/each}
							</div>
							<input
								type="date"
								name="sealUntil"
								bind:value={sealUntil}
								min={minSeal}
								max={maxSeal}
								aria-labelledby="reveal-label"
								aria-label="Reveal on"
								class="field text-[16px]"
							/>
						</div>

						{#if sealSummary}
							<p
								class="rounded-[10px] px-3.5 py-2.5 text-[14px]"
								style="background: color-mix(in oklab, var(--seal) 12%, transparent); color: var(--ink-2)"
								aria-live="polite"
							>
								{sealSummary}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if form?.error}
			<div
				class="card p-4 text-[15px]"
				style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
			>
				{form.error}
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-3">
			<button
				name="intent"
				value="log"
				aria-label="Log it — already bought"
				class="btn btn-accent flex-col gap-0 py-3.5"
			>
				<span>Log it</span>
				<span class="text-[12px] font-normal opacity-80">Already bought</span>
			</button>
			<button
				name="intent"
				value="request"
				aria-label="Ask first — needs approval"
				class="btn btn-ghost flex-col gap-0 py-3.5"
			>
				<span>Ask first</span>
				<span class="text-[12px] font-normal" style="color: var(--ink-3)">Needs approval</span>
			</button>
		</div>

		<button
			type="button"
			onclick={() => (showSleep = true)}
			disabled={!itemName || !amount}
			class="btn w-full py-3 text-[15px] disabled:opacity-40"
			style="color: color-mix(in oklab, var(--seal) 84%, var(--ink)); background: color-mix(in oklab, var(--seal) 10%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--seal) 26%, transparent)"
		>
			<Moon class="h-4 w-4" /> Sleep on it
		</button>

		{#if showSleep}
			<div
				class="fixed inset-0 z-50"
				style="background: var(--scrim)"
				use:dismiss={() => (showSleep = false)}
				transition:fade={{ duration: 140 }}
			></div>
			<div
				class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
				role="dialog"
				aria-modal="true"
				aria-label="Sleep on it"
				transition:fly={{ y: 24, duration: 200 }}
			>
				<div
					class="card-lg overflow-hidden p-5"
					style="box-shadow: var(--shadow-float); background: var(--surface)"
				>
					<div class="flex items-center justify-between">
						<h2
							class="font-[family-name:var(--font-display)] text-[22px]"
							style="color: var(--ink)"
						>
							Sleep on it
						</h2>
						<button
							type="button"
							onclick={() => (showSleep = false)}
							class="press -mr-1 flex h-8 w-8 items-center justify-center rounded-full"
							style="color: var(--ink-3)"
							aria-label="Close"
						>
							<X class="h-4 w-4" />
						</button>
					</div>
					<p class="mt-1 text-[13px]" style="color: var(--ink-3)">
						Take some time before deciding. We've suggested how long based on the amount — spin to
						change it.
					</p>
					<div class="mt-3">
						<HoldPicker amountMinor={amountMinorForPicker} bind:days={sleepDays} />
					</div>
					<input type="hidden" name="sleepDays" value={sleepDays} />
					<button name="intent" value="request" class="btn btn-accent mt-3 w-full py-3 text-[15px]">
						Sleep on it
					</button>
				</div>
			</div>
		{/if}
	</form>
</div>
