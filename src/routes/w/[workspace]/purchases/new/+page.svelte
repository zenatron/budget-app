<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import { money } from '$lib/actions/money';
	import { onDestroy } from 'svelte';
	import { calDateInZone } from '$lib/domain/time/zoned';

	import BillImport from '$lib/components/BillImport.svelte';
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	let showGift = $state(false);
	let photoPreview: string | null = $state(null);

	// Bound so the bill importer can fill them. Everything else on this form
	// stays uncontrolled — these three are the only fields a bill can speak to.
	let amount = $state('');
	let itemName = $state('');
	let merchantName = $state('');
	let photoInput: HTMLInputElement | null = $state(null);

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
		<Icon name="chevronLeft" class="h-4 w-4" /> Ledger
	</a>

	{#if data.billImportEnabled}
		<button
			type="button"
			onclick={() => (scanning = true)}
			class="press card flex w-full items-center gap-3 p-4 text-left"
		>
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
				style="background: color-mix(in oklab, var(--pending) 14%, var(--surface))"
			>
				<Icon name="search" class="h-[18px] w-[18px]" style="color: var(--pending)" />
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
				<span class="mt-0.5 block text-[13px]" style="color: var(--ink-4)"
					>Reads the number. You still enter the price.</span
				>
			</span>
			<Icon name="chevronRight" class="h-4 w-4 shrink-0" style="color: var(--ink-4)" />
		</button>

		<BarcodeScanner bind:open={scanning} onscan={applyScan} onphoto={applyScanPhoto} />

		<BillImport currency={data.workspace.currency} dayFirst={data.dayFirst} onapply={applyBill} />
	{/if}

	<form method="POST" enctype="multipart/form-data" use:submit class="space-y-4">
		<!-- Amount: the focal point -->
		<div class="card-lg card px-6 py-8 text-center">
			<label class="block">
				<span class="section-label">Amount</span>
				<div class="mt-3 flex items-center justify-center">
					<span
						class="font-[family-name:var(--font-display)] text-[34px] font-semibold"
						style="color: var(--ink-4)">{symbol}</span
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
				<Icon name="bag" class="h-5 w-5" style="color: var(--ink-4)" />
				<input
					name="itemName"
					aria-label="Item"
					bind:value={itemName}
					required
					maxlength="120"
					placeholder="What did you buy?"
					class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
					style="color: var(--ink)"
				/>
			</label>
			<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
				<Icon name="pin" class="h-5 w-5" style="color: var(--ink-4)" />
				<input
					name="merchantName"
					aria-label="Merchant"
					bind:value={merchantName}
					maxlength="200"
					placeholder="Where did you buy it?"
					class="flex-1 border-none bg-transparent p-0 text-[17px] outline-none placeholder:opacity-40"
					style="color: var(--ink)"
				/>
			</div>
			<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
				<Icon name="card" class="h-5 w-5" style="color: var(--ink-4)" />
				<select
					name="categoryId"
					class="-mx-1 flex-1 border-none bg-transparent p-0 text-[17px] outline-none"
					style="color: var(--ink); appearance: none; background-image: none"
				>
					<option value="">No category</option>
					{#each data.categories as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
				</select>
				<Icon name="chevronDown" class="h-4 w-4" style="color: var(--ink-4)" />
			</div>
			{#if data.buckets.length > 0}
				<div class="row hairline" style="box-shadow: inset 0 0.5px 0 var(--hairline)">
					<Icon name="bank" class="h-5 w-5" style="color: var(--ink-4)" />
					<select
						name="bucketId"
						class="-mx-1 flex-1 border-none bg-transparent p-0 text-[17px] outline-none"
						style="color: var(--ink); appearance: none; background-image: none"
					>
						<option value="">Charge to bucket</option>
						{#each data.buckets as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
					</select>
					<Icon name="chevronDown" class="h-4 w-4" style="color: var(--ink-4)" />
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
					<Icon name="camera" class="h-5 w-5" style="color: var(--ink-4)" />
					<span class="flex-1 text-[17px]" style="color: var(--ink-4)">Add a photo (optional)</span>
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
				<Icon name="clock" class="mt-0.5 h-5 w-5" style="color: var(--ink-4)" />
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
				<Icon name="calendar" class="h-5 w-5" style="color: var(--ink-4)" />
				<span class="flex-1 text-[16px]" style="color: var(--ink-4)">When</span>
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
						<Icon name="gift" class="h-[18px] w-[18px]" style="color: var(--seal)" />
					</span>
					<div class="flex-1">
						<p class="text-[15px] font-semibold" style="color: var(--seal)">
							Gift mode — hide this purchase
						</p>
						<p class="text-[13px]" style="color: var(--ink-3)">
							Invisible to who you pick, including totals
						</p>
					</div>
					<Icon
						name="chevronDown"
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
				<span class="text-[12px] font-normal" style="color: var(--ink-4)">Needs approval</span>
			</button>
		</div>
	</form>
</div>
