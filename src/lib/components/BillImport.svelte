<script lang="ts">
	/**
	 * Alpha: read a bill PDF and offer what it found.
	 *
	 * It never fills the form on its own. The parser guesses — it is rules and
	 * geometry, not comprehension — so the whole interaction is built around
	 * showing its working: the line each figure came from, the runners-up it
	 * rejected, and a page picker that preselects the page the amount was on. You
	 * always press Use before anything moves.
	 *
	 * The chosen page is rendered to WebP here and handed to the form's existing
	 * photo input, so the upload goes through the same hardened image pipeline as
	 * a photographed receipt — nothing on the server had to learn about PDFs.
	 */
	import { ChevronRight, Sparkles } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import type { ReadPdfResult } from '$lib/bill/read-pdf';
	import type { MoneyCandidate } from '$lib/domain/bill/extract';

	let {
		currency,
		dayFirst = false,
		vision = { allowed: false, reason: '' },
		slug,
		onapply
	}: {
		currency: string;
		/** Workspace convention for 03/04/2026. */
		dayFirst?: boolean;
		/**
		 * Whether a scan can be offered to the model, decided on the server — see
		 * `server/vision-gate`. `certain: false` means we never established what the
		 * model can do and are trying anyway, which the copy below admits to rather
		 * than promising something it may not deliver.
		 */
		vision?: { allowed: true; certain: boolean } | { allowed: false; reason: string };
		slug: string;
		onapply: (v: { amount: string; vendor: string | null; image: File | null }) => void;
	} = $props();

	let busy = $state(false);
	let error: string | null = $state(null);
	/**
	 * A scan we've read the pages of but have no text for. Held here rather than
	 * acted on: reading it costs a model call and up to a minute, so it is offered
	 * and not taken. See `scanned` in the markup.
	 */
	let scanned: ReadPdfResult | null = $state(null);
	let reading = $state(false);
	let result: ReadPdfResult | null = $state(null);
	let chosenAmount: MoneyCandidate | null = $state(null);
	let chosenPage = $state(1);

	const major = (minor: number) => (minor / 100).toFixed(2);

	const fmt = (minor: number) =>
		(minor / 100).toLocaleString(undefined, { style: 'currency', currency });

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Clear immediately: picking the same file twice must re-trigger change.
		input.value = '';
		if (!file) return;

		reset();
		busy = true;
		try {
			const { readPdf } = await import('$lib/bill/read-pdf');
			const r = await readPdf(file, { dayFirst });
			if (r.extraction.isScanned) {
				/*
				 * No text layer — this is a photograph of a page. The deterministic
				 * extractor has nothing to work with, and this used to be where the
				 * feature stopped. But the page image is already rendered, so if a
				 * model that can look at it is configured, offer that instead of a
				 * dead end. Still an offer: the read is slow and it is theirs to spend.
				 */
				if (vision.allowed) {
					scanned = r;
					return;
				}
				r.dispose();
				error = vision.reason
					? `This PDF is a scan, so there's no text to read. ${vision.reason}`
					: "This PDF is a scan, so there's no text to read. You can still enter the amount yourself.";
				return;
			}
			if (!r.extraction.total) {
				r.dispose();
				error = "Couldn't find an amount on this bill. Enter it yourself?";
				return;
			}
			result = r;
			chosenAmount = r.extraction.total;
			chosenPage = r.suggestedPage;
		} catch {
			error = "Couldn't read that PDF.";
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!result || !chosenAmount) return;
		busy = true;
		try {
			const blob = await result.renderPage(chosenPage);
			const image = new File([blob], `bill-p${chosenPage}.webp`, { type: 'image/webp' });
			onapply({
				amount: major(chosenAmount.minor),
				vendor: result.extraction.vendor,
				image
			});
			reset();
		} catch {
			error = "Couldn't attach that page.";
			busy = false;
		}
	}

	/**
	 * Send the first page to the model and prefill from whatever survives the
	 * app's own parsers. A field that didn't survive is simply absent, so a bill
	 * whose total reads and whose date doesn't lands the total and leaves the rest
	 * to the person — which is still better than the empty form this replaces.
	 */
	async function readScan() {
		if (!scanned) return;
		reading = true;
		error = null;
		try {
			const blob = await scanned.renderPage(1);
			const body = new FormData();
			body.append('image', new File([blob], 'bill-p1.webp', { type: 'image/webp' }));
			body.append('kind', 'bill');
			const res = await fetch(`/w/${slug}/read-image`, { method: 'POST', body });
			if (!res.ok) throw new Error(String(res.status));
			const { read } = (await res.json()) as {
				read: { totalMinor: string | null; vendor: string | null; dueDate: string | null } | null;
			};
			if (!read || (!read.totalMinor && !read.vendor)) {
				error = "Couldn't make out this bill. Enter the amount yourself?";
				return;
			}
			const image = new File([blob], 'bill-p1.webp', { type: 'image/webp' });
			onapply({
				amount: read.totalMinor ? major(Number(read.totalMinor)) : '',
				vendor: read.vendor,
				image
			});
			reset();
		} catch {
			error = "Couldn't read that scan.";
		} finally {
			reading = false;
		}
	}

	function reset() {
		result?.dispose();
		result = null;
		scanned?.dispose();
		scanned = null;
		reading = false;
		chosenAmount = null;
		chosenPage = 1;
		error = null;
		busy = false;
	}

	onDestroy(() => {
		result?.dispose();
		scanned?.dispose();
	});
</script>

<div class="card overflow-hidden">
	{#if scanned}
		<!--
			A scan, and a model that might be able to look at it. Stated as an offer
			with its cost attached, because the read is genuinely slow and can come
			back with nothing — and because "we couldn't establish what your model
			does" is a real answer we'd rather admit than paper over.
		-->
		<div class="p-4">
			<p class="section-label">A scanned bill</p>
			<p class="mt-2 text-[14px] leading-relaxed" style="color: var(--ink-2)">
				There's no text in this PDF to read, so it's a picture of a page. Harmony can look at it and
				try to make out the amount — that takes a moment, and it's a guess you'll confirm before
				anything moves.
			</p>
			{#if vision.allowed && !vision.certain}
				<p class="mt-2 text-[12.5px] leading-relaxed" style="color: var(--ink-3)">
					We couldn't tell whether your model reads images. If it can't, you'll see its own error
					and nothing will have changed.
				</p>
			{/if}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<button
					onclick={readScan}
					disabled={reading}
					class="btn btn-accent px-3.5 py-1.5 text-[13px]"
				>
					<Sparkles class="h-3.5 w-3.5" />
					{reading ? 'Looking at it…' : 'Have a look'}
				</button>
				<button
					onclick={reset}
					class="press text-[13px] underline underline-offset-2"
					style="color: var(--ink-3)">I'll type it</button
				>
			</div>
			{#if error}
				<p class="mt-2 text-[13px]" style="color: var(--ink-3)">{error}</p>
			{/if}
		</div>
	{:else if !result}
		<!--
			An action, not a field. The rows in the form below are things you fill in
			and are styled as such — placeholder-grey with the label doing the asking.
			This one *does* something, so it carries ink-weight text and a chevron,
			and the Alpha chip sits inline after the title rather than flush right,
			where it was crowding the card edge on narrow screens.
		-->
		<label class="flex cursor-pointer items-center gap-3 p-4">
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
				style="background: color-mix(in oklab, var(--ws-accent) 14%, var(--surface))"
			>
				<Sparkles class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-[15px] font-medium" style="color: var(--ink)">
						{busy ? 'Reading the bill…' : 'Read a bill'}
					</span>
					<span
						class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
						style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
						>Alpha</span
					>
				</span>
				<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)">
					{busy ? 'This can take a moment' : 'Fills in the amount from a PDF'}
				</span>
			</span>
			{#if !busy}
				<ChevronRight class="h-4 w-4 shrink-0" style="color: var(--ink-4)" />
			{/if}
			<input
				type="file"
				accept="application/pdf,.pdf"
				class="sr-only"
				disabled={busy}
				onchange={onPick}
			/>
		</label>
		{#if error}
			<p class="-mt-1 px-4 pb-4 text-[13px]" style="color: var(--ink-3)">{error}</p>
		{/if}
	{:else}
		<div class="p-4">
			<div class="flex items-baseline justify-between">
				<p class="section-label">Found on this bill</p>
				<button
					onclick={reset}
					class="press text-[13px] underline underline-offset-2"
					style="color: var(--ink-3)">Cancel</button
				>
			</div>

			{#if result.extraction.vendor}
				<p class="mt-2 text-[15px]" style="color: var(--ink-2)">{result.extraction.vendor}</p>
			{/if}

			<p
				class="num mt-1 font-[family-name:var(--font-display)] text-[34px] leading-none font-bold"
				style="color: var(--ink)"
			>
				{chosenAmount ? fmt(chosenAmount.minor) : ''}
			</p>
			<!-- The line it came from. A guess you can check is worth far more than
			     a number presented as fact. -->
			{#if chosenAmount}
				<p class="mt-1.5 text-[12px]" style="color: var(--ink-3)">
					from “{chosenAmount.context}”
				</p>
			{/if}

			{#if result.extraction.alternates.length > 0}
				<p class="section-label mt-4 mb-1.5">Or did you mean</p>
				<div class="flex flex-wrap gap-2">
					{#each result.extraction.alternates as alt (alt.minor)}
						<button
							onclick={() => (chosenAmount = alt)}
							class="press rounded-[var(--r-full)] px-3 py-1.5 text-[13px]"
							style="background: {chosenAmount?.minor === alt.minor
								? 'var(--surface-hi)'
								: 'var(--surface-2)'}; color: var(--ink-2)"
						>
							{fmt(alt.minor)}
						</button>
					{/each}
				</div>
			{/if}

			{#if result.extraction.dueDate}
				<p class="mt-3 text-[13px]" style="color: var(--ink-3)">
					Due {result.extraction.dueDate.date}{result.extraction.dueDate.ambiguous
						? ' — day and month could be either way round'
						: ''}
				</p>
			{/if}

			<!-- Only worth asking when there is a choice; one page needs no picker. -->
			{#if result.pages.length > 1}
				<p class="section-label mt-4 mb-1.5">Keep which page</p>
				<div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
					{#each result.pages as pg (pg.pageNumber)}
						<button
							onclick={() => (chosenPage = pg.pageNumber)}
							aria-label="Page {pg.pageNumber}"
							aria-pressed={chosenPage === pg.pageNumber}
							class="press shrink-0 overflow-hidden rounded-[var(--r-sm)]"
							style="box-shadow: 0 0 0 {chosenPage === pg.pageNumber
								? '2px var(--ink)'
								: '1px var(--hairline)'}"
						>
							<img src={pg.previewUrl} alt="" class="h-[110px] w-auto" />
						</button>
					{/each}
				</div>
			{/if}

			<button
				onclick={apply}
				disabled={busy || !chosenAmount}
				class="btn btn-accent mt-4 w-full disabled:opacity-50"
			>
				{busy ? 'Attaching…' : 'Use these details'}
			</button>
		</div>
	{/if}
</div>
