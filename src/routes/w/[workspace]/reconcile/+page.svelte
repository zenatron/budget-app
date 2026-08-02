<script lang="ts">
	import { page } from '$app/state';
	import { submit } from '$lib/actions/submit';
	import { ChevronLeft, ChevronRight, FileText, Upload } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let slug = $derived(page.params.workspace);

	/** The mapper appears only when auto-detection gave up on a file. */
	const mapping = $derived(
		form && 'needsMapping' in form && form.needsMapping
			? (form as unknown as {
					filename: string;
					headers: string[];
					csv: string;
					accountId: string | null;
				})
			: null
	);

	/*
	 * The PDF path. A CSV is posted as a file and read on the server; a PDF is
	 * read here, in the browser, and only the three columns pulled out of it are
	 * posted. A bank statement carries far more than the ledger needs — card
	 * numbers, addresses, every transaction that has nothing to do with this app —
	 * so the document itself stays on the device.
	 */
	let uploadForm = $state<HTMLFormElement | null>(null);
	let derivedCsv = $state('');
	let derivedName = $state('');
	let format = $state<'csv' | 'pdf'>('csv');
	let reading = $state(false);
	let pdfError = $state('');

	async function chooseFile(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		pdfError = '';

		const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
		if (!isPdf) {
			// Straight through as a file, exactly as before.
			derivedCsv = '';
			derivedName = '';
			format = 'csv';
			uploadForm?.requestSubmit();
			return;
		}

		reading = true;
		try {
			const { readStatementPdf } = await import('$lib/reconcile/read-statement-pdf');
			const result = await readStatementPdf(file);
			if (result.rows.length === 0) {
				pdfError = "Couldn't find any transactions in that PDF. A CSV export will work better.";
				return;
			}
			derivedCsv = result.csv;
			derivedName = file.name;
			format = 'pdf';
			// The file input still holds the PDF; clear it so the server reads the
			// extracted rows rather than trying to parse the document as a CSV.
			e.currentTarget.value = '';
			uploadForm?.requestSubmit();
		} catch {
			pdfError = "Couldn't read that PDF. A CSV export from your bank will work better.";
		} finally {
			reading = false;
		}
	}

	function fmtDate(iso: string | Date): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function fmtDateLong(iso: string | Date): string {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	/** "Jun 1 – Jun 30", or the import date when the file carried no dates. */
	function periodLabel(from: string | Date | null, to: string | Date | null): string | null {
		if (!from || !to) return null;
		return `${fmtDate(from)} – ${fmtDate(to)}`;
	}
</script>

<svelte:head><title>Reconcile — Ledger</title></svelte:head>

<div class="mx-auto max-w-lg">
	<a
		href="/w/{slug}"
		class="press mb-4 -ml-1 inline-flex items-center gap-0.5 text-[14px] font-medium"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>

	<div class="px-1">
		<p class="section-label">Statements</p>
		<h1 class="mt-1 text-[28px]">Reconcile</h1>
		<p class="mt-2 text-[15px] leading-relaxed" style="color: var(--ink-3)">
			Import a CSV or PDF from your bank and tick it against what's recorded here. Nothing is
			created, edited or deleted — this only marks what has cleared. A PDF is read on your device;
			only the dates, amounts and descriptions are sent.
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

	{#if mapping}
		<!--
			Auto-detection failed. Rather than sending the person away to reformat a
			file, name the columns here. The CSV rides back in a hidden field so the
			file doesn't have to be chosen a second time.
		-->
		<form
			method="POST"
			action="?/uploadMapped"
			use:submit={{ reset: false }}
			class="card mt-4 space-y-4 p-5"
		>
			<div>
				<p class="text-[15px] font-semibold" style="color: var(--ink)">Which column is which?</p>
				<p class="mt-0.5 text-[13px]" style="color: var(--ink-3)">
					{mapping.filename} — its headers didn't match anything recognisable.
				</p>
			</div>

			<input type="hidden" name="csv" value={mapping.csv} />
			<input type="hidden" name="filename" value={mapping.filename} />
			<input type="hidden" name="accountId" value={mapping.accountId ?? ''} />
			<input type="hidden" name="format" value={format} />

			{#each [{ name: 'dateCol', label: 'Date' }, { name: 'amountCol', label: 'Amount' }, { name: 'descriptionCol', label: 'Description' }] as f (f.name)}
				<label class="block">
					<span class="section-label mb-1.5 block">{f.label}</span>
					<select name={f.name} class="field text-[16px]" required>
						{#each mapping.headers as h, i (i)}
							<option value={i}>{h || `Column ${i + 1}`}</option>
						{/each}
					</select>
				</label>
			{/each}

			<label class="block">
				<span class="section-label mb-1.5 block">Date order</span>
				<select name="dateOrder" class="field text-[16px]">
					<option value="MDY">Month / Day / Year</option>
					<option value="DMY">Day / Month / Year</option>
					<option value="YMD">Year / Month / Day</option>
				</select>
			</label>

			<label class="flex items-start gap-2.5">
				<input type="checkbox" name="invertAmount" class="mt-0.5" />
				<span class="text-[14px] leading-snug" style="color: var(--ink-2)">
					Positive amounts are money going out
					<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)">
						Tick this if your bank lists spending as positive numbers.
					</span>
				</span>
			</label>

			<button class="btn btn-accent w-full">Import with these columns</button>
		</form>
	{:else}
		<form
			bind:this={uploadForm}
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			use:submit={{ reset: false }}
			class="mt-5"
		>
			<!-- Filled in only on the PDF path, where the browser did the reading. -->
			<input type="hidden" name="csv" bind:value={derivedCsv} />
			<input type="hidden" name="filename" bind:value={derivedName} />
			<input type="hidden" name="format" bind:value={format} />

			{#if data.accounts.length > 0}
				<label class="mb-3 block">
					<span class="section-label mb-1.5 block">Which card is this?</span>
					<select name="accountId" class="field text-[16px]">
						<option value="">Not sure / all cards</option>
						{#each data.accounts as a (a.id)}
							<option value={a.id}>{a.last4 ? `${a.name} ·${a.last4}` : a.name}</option>
						{/each}
					</select>
					<span class="mt-1.5 block text-[13px] leading-snug" style="color: var(--ink-3)">
						Naming the card keeps one statement from claiming another card's purchases.
					</span>
				</label>
			{/if}

			<label
				class="press flex cursor-pointer items-center gap-3.5 rounded-[14px] p-4"
				style="box-shadow: inset 0 0 0 1px var(--hairline); background: var(--surface)"
			>
				<span
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
					style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
				>
					{#if reading}
						<span
							class="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
							style="color: var(--ws-accent)"
						></span>
					{:else}
						<Upload class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
					{/if}
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-[15px] font-medium" style="color: var(--ink)">
						{reading ? 'Reading the statement…' : 'Import a statement'}
					</span>
					<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)">
						{pdfError ? pdfError : 'A CSV or PDF from your bank'}
					</span>
				</span>
				<input
					type="file"
					name="statement"
					accept=".csv,text/csv,.pdf,application/pdf"
					required
					class="sr-only"
					onchange={chooseFile}
				/>
			</label>
			<button type="submit" class="sr-only">Import</button>
		</form>

		<!--
			Cards are named here rather than buried in settings: the moment you need
			one is the moment you are importing a second card's statement.
		-->
		<details class="mt-3 px-1">
			<summary class="cursor-pointer text-[13px]" style="color: var(--ink-3)">
				{data.accounts.length > 0 ? 'Add another card' : 'Name your cards'}
			</summary>
			<form method="POST" action="?/addAccount" use:submit class="mt-2 flex items-end gap-2">
				<label class="min-w-0 flex-1">
					<span class="section-label mb-1.5 block">Name</span>
					<input name="name" required maxlength="60" placeholder="Visa" class="field text-[16px]" />
				</label>
				<label class="w-24 shrink-0">
					<span class="section-label mb-1.5 block">Last 4</span>
					<input
						name="last4"
						inputmode="numeric"
						maxlength="4"
						placeholder="1234"
						class="field text-[16px]"
					/>
				</label>
				<button class="btn btn-ghost shrink-0 px-4 py-2.5 text-[14px]">Add</button>
			</form>
		</details>
	{/if}

	{#if data.imports.length === 0}
		<div class="mt-8 px-6 py-10 text-center">
			<div
				class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px]"
				style="background: radial-gradient(120% 120% at 30% 20%, color-mix(in oklab, var(--ws-accent) 40%, var(--surface)), var(--surface))"
			>
				<FileText class="h-8 w-8" style="color: color-mix(in oklab, var(--ws-accent) 80%, white)" />
			</div>
			<p class="text-[19px] font-semibold" style="color: var(--ink)">No statements yet</p>
			<p
				class="mx-auto mt-1.5 max-w-[30ch] text-[15px] leading-relaxed"
				style="color: var(--ink-3)"
			>
				Most banks export a CSV from their transactions page, and a PDF statement works too. Import
				one and Ledger will line it up against what's here.
			</p>
		</div>
	{:else}
		<p class="section-label mt-8 mb-1 px-1">Imported</p>
		<div class="rule">
			{#each data.imports as imp, i (imp.id)}
				{@const period = periodLabel(imp.periodStart, imp.periodEnd)}
				{@const done = imp.confirmedCount >= imp.lineCount}
				<a
					href="/w/{slug}/reconcile/{imp.id}"
					class="press flex items-center gap-3 px-1 py-3.5 {i === data.imports.length - 1
						? ''
						: 'hairline'}"
				>
					<div class="min-w-0 flex-1">
						<p class="truncate text-[16px] font-medium" style="color: var(--ink)">
							{period ?? imp.filename}
						</p>
						<p class="mt-0.5 truncate text-[13px]" style="color: var(--ink-3)">
							{imp.lineCount}
							{imp.lineCount === 1 ? 'line' : 'lines'} · {imp.importedByName} · {fmtDateLong(
								imp.createdAt
							)}
						</p>
					</div>
					<!--
						Progress as a fraction, not a bar: reconciling is counted work with a
						known end, and "12 / 40" says how much is left in a way a bar can't.
					-->
					<span
						class="num shrink-0 text-[13px]"
						style="color: {done ? 'var(--approve)' : 'var(--ink-3)'}"
					>
						{imp.confirmedCount}/{imp.lineCount}
					</span>
					<ChevronRight class="h-4 w-4 shrink-0" style="color: var(--ink-4)" />
				</a>
			{/each}
		</div>
	{/if}
</div>
