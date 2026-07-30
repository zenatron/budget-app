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
			? (form as unknown as { filename: string; headers: string[]; csv: string })
			: null
	);

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
			Import a CSV from your bank and tick it against what's recorded here. Nothing is created,
			edited or deleted — this only marks what has cleared.
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
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			use:submit={{ reset: false }}
			class="mt-5"
		>
			<label
				class="press flex cursor-pointer items-center gap-3.5 rounded-[14px] p-4"
				style="box-shadow: inset 0 0 0 1px var(--hairline); background: var(--surface)"
			>
				<span
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
					style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
				>
					<Upload class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-[15px] font-medium" style="color: var(--ink)"
						>Import a statement</span
					>
					<span class="mt-0.5 block text-[13px]" style="color: var(--ink-3)"
						>A CSV export from your bank</span
					>
				</span>
				<input
					type="file"
					name="statement"
					accept=".csv,text/csv"
					required
					class="sr-only"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
				/>
			</label>
			<button type="submit" class="sr-only">Import</button>
		</form>
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
				Most banks export a CSV from their transactions page. Import one and Ledger will line it up
				against what's here.
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
