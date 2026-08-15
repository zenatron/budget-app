<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import Toggle from '$lib/components/Toggle.svelte';
	import {
		ChevronLeft,
		Check,
		CircleAlert,
		MapPin,
		RefreshCw,
		ScanEye,
		ScanLine,
		ShieldCheck,
		Sparkles
	} from '@lucide/svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	const owner = $derived(data.isOwner);

	let mode = $state<'off' | 'local' | 'external'>(data.config.mode);
	let endpoint = $state(data.config.endpoint);
	let model = $state(data.config.model);
	let apiKey = $state('');

	// Re-sync form state from the server after a successful save — never after a
	// test request (which doesn't write), and never during ordinary interaction
	// (where the server value is stale relative to what the user is typing).
	$effect(() => {
		if (!form?.ok) return;
		mode = data.config.mode;
		endpoint = data.config.endpoint;
		model = data.config.model;
		apiKey = '';
	});

	const MODES = [
		{ value: 'off', label: 'Off' },
		{ value: 'local', label: 'Local' },
		{ value: 'external', label: 'External' }
	] as const;

	const testResult = $derived(form && 'test' in form ? form.test : null);
	const geoHealth = $derived(form && 'geocoder' in form ? form.geocoder : null);

	/**
	 * Green only when the check actually proved something. A provider that is up
	 * but found nothing for the address you gave it is the case this whole panel
	 * exists for — the extract doesn't cover you — so it must not read as a pass.
	 */
	const geoPassed = $derived(
		geoHealth?.state === 'ready' && (geoHealth.probe === null || geoHealth.probe.found > 0)
	);
	function geoTone(state: string): string {
		if (geoPassed) return 'var(--approve)';
		if (state === 'ready' || state === 'starting') return 'var(--pending)';
		return 'var(--deny)';
	}

	const availableModels = $derived(testResult?.models ?? []);

	/*
	 * Chip colours carry meaning rather than decorating: vision is the one people
	 * are hunting for when they scan this list, so it gets the accent, and the
	 * rest sit back in the neutral ink. Anything Ollama reports that we don't
	 * recognise still renders — it just renders quietly.
	 */
	function capTone(cap: string): string {
		if (cap === 'vision') return 'var(--ws-accent)';
		if (cap === 'tools') return 'var(--info)';
		if (cap === 'thinking') return 'var(--seal)';
		return 'var(--ink-3)';
	}
</script>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[15px]"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>
	<h1 class="px-1 text-[28px]">Harmony</h1>

	<!-- The deterministic suite: always on. -->
	<div class="card p-4">
		<p class="flex items-center gap-1.5 text-[15px] font-medium" style="color: var(--ink)">
			<Sparkles class="h-4 w-4 shrink-0" style="color: var(--ws-accent)" />
			Harmony Intelligence
			<span
				class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
				style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
				>Alpha</span
			>
		</p>
		<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
			Works out what's genuinely safe to spend this month, and answers questions about your money in
			plain language.
		</p>
		<a
			href="/w/{slug}/settings/help?s=safe-to-spend"
			class="press mt-1 inline-block text-[13px] font-medium"
			style="color: var(--ws-accent)">How it works</a
		>
	</div>

	<div class="card flex items-center justify-between gap-4 p-4">
		<div>
			<p class="flex items-center gap-1.5 text-[15px] font-medium" style="color: var(--ink)">
				<ScanEye class="h-4 w-4 shrink-0" style="color: var(--ws-accent)" />
				Read a bill or receipt
			</p>
			<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Extracts text from a PDF or image. The AI can help interpret fuzzy amounts, but always asks
				you to confirm before anything lands in the ledger.
			</p>
		</div>
		{#if owner}
			<Toggle
				on={data.billImportEnabled}
				flag="billImportEnabled"
				label="Toggle reading a bill or receipt"
			/>
		{/if}
	</div>

	<div class="card flex items-start justify-between gap-4 p-4">
		<div>
			<p class="flex items-center gap-1.5 text-[15px] font-medium" style="color: var(--ink)">
				<ScanLine class="h-4 w-4 shrink-0" style="color: var(--ws-accent)" />
				Scan a barcode
			</p>
			<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Point your camera at a barcode to capture the product code. To look up a product name and
				category, wire up a product-lookup API like <a
					href="https://world.openfoodfacts.org/data"
					target="_blank"
					rel="noopener noreferrer"
					class="underline decoration-dotted"
					style="color: var(--ws-accent)">Open Food Facts</a
				> — set the URL in your deployment's environment.
			</p>
			{#if !data.barcodeConfigured}
				<p
					class="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed"
					style="color: var(--pending)"
				>
					<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>
						Barcode lookup isn't configured. Set <code class="font-mono text-[11px]"
							>BARCODE_LOOKUP_URL</code
						>
						in your deployment environment to enable this.
					</span>
				</p>
			{/if}
		</div>
		{#if owner}
			<Toggle
				on={data.barcodeEnabled}
				flag="barcodeEnabled"
				label="Toggle scanning a barcode"
				disabled={!data.barcodeConfigured}
			/>
		{/if}
	</div>

	<!--
		Places. The copy carries the honest version of what 110 m means on purpose:
		"rounded" invites people to read "anonymised", and it isn't. Understating it
		here would be the one place in the app where the interface is less truthful
		than the thing it describes.
	-->
	<div class="card flex items-start justify-between gap-4 p-4">
		<div>
			<p class="flex items-center gap-1.5 text-[15px] font-medium" style="color: var(--ink)">
				<MapPin class="h-4 w-4 shrink-0" style="color: var(--ws-accent)" />
				Places
			</p>
			<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Attach a place to a purchase and see where the money goes on a map. Nothing is ever captured
				on its own — you tap <strong style="color: var(--ink-2)">Use my location</strong>, type an
				address, or paste a map link.
			</p>
			<p class="mt-2 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Pins are rounded to about 110&nbsp;m before they're stored. That's a block, not a doorstep —
				but it is still enough to recognise a home. Places follow the same seal rules as everything
				else: a purchase you can't see has no pin you can see.
			</p>
			{#if !data.tileConfigured}
				<p
					class="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed"
					style="color: var(--pending)"
				>
					<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>
						No basemap configured. The map still works — it draws your spending on a plotted grid
						instead of streets. Set <code class="font-mono text-[11px]">MAP_TILE_URL</code> to a raster
						tile template to add streets. Tiles are fetched by the server and re-served from this origin,
						so your browser never talks to the tile provider.
					</span>
				</p>
			{:else}
				<p class="mt-2 text-[12px] leading-relaxed" style="color: var(--ink-4)">
					Basemap: {data.tileAttribution}
				</p>
			{/if}
			{#if !data.geocoderConfigured}
				<p
					class="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed"
					style="color: var(--pending)"
				>
					<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>
						No address search configured. You can still use your device's location and paste map
						links — those are read offline and never leave this machine. Set <code
							class="font-mono text-[11px]">GEOCODER_URL</code
						> to a Nominatim-compatible endpoint to search addresses; self-host it if you can.
					</span>
				</p>
			{:else if owner}
				<!--
					Address search is the one optional layer whose failures are all
					invisible by design — off, unreachable, mid-import and "not in the
					imported extract" reach the form as the same empty list, because a
					person recording a purchase can do nothing with the difference. An
					operator can, and this is where they're told apart. It sits behind a
					button rather than probing on load: this is the only thing on the page
					that reaches out to another service just for being looked at.
				-->
				<div class="mt-2.5 border-t pt-2.5" style="border-color: var(--hairline)">
					<p class="text-[12px] leading-relaxed" style="color: var(--ink-4)">
						Address search: <span class="font-mono">{data.geocoderEndpoint}</span>
					</p>
					<!--
						`.field` unmodified, at its own 17px. Anything under 16px in a text
						input makes iOS Safari zoom the viewport on focus and leave it
						there — the page is an installed PWA, so that lands as the layout
						visibly lurching under someone's thumb.
					-->
					<form
						method="POST"
						action="?/checkGeocoder"
						use:submit={{ reset: false }}
						class="mt-2 space-y-2"
					>
						<input
							name="probe"
							class="field"
							placeholder="Test an address near you"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							enterkeyhint="search"
						/>
						<button class="btn btn-ghost px-4 py-2 text-[14px]">Check</button>
					</form>
					{#if geoHealth}
						<p
							class="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed"
							style="color: {geoTone(geoHealth.state)}"
						>
							{#if geoPassed}
								<Check class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							{:else}
								<CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							{/if}
							<span>
								{geoHealth.detail}
								{#if geoHealth.probe}
									{#if geoHealth.probe.first}
										<br />Best match:
										<span style="color: var(--ink-2)">{geoHealth.probe.first}</span>
									{/if}
								{/if}
								{#if geoHealth.dataUpdated}
									<br /><span style="color: var(--ink-4)"
										>Data imported up to {geoHealth.dataUpdated}.</span
									>
								{/if}
							</span>
						</p>
					{/if}
				</div>
			{/if}
		</div>
		{#if owner}
			<Toggle on={data.locationEnabled} flag="locationEnabled" label="Toggle places" />
		{/if}
	</div>

	<p class="section-label px-1 pt-2">AI assistance</p>

	<!-- What this is, and the line it never crosses. -->
	<section class="card p-5">
		<h2
			class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			<Sparkles class="h-4 w-4" style="color: var(--ws-accent)" /> A helper, never a decider
		</h2>
		<p class="mt-2 text-[13px] leading-relaxed" style="color: var(--ink-2)">
			Harmony works entirely on plain arithmetic and pattern matching. You can optionally let a
			language model help with the fuzzy parts, like reading a cryptic bank line into a merchant
			name or suggesting a category. It only ever <strong style="color: var(--ink)">suggests</strong
			>: it never approves a purchase, moves money, or decides your Safe to Spend. Every suggestion
			is checked against the app's own options before you see it, so a bad answer becomes no answer.
		</p>
		<p class="mt-2 text-[13px] leading-relaxed" style="color: var(--ink-3)">
			Leave it <strong style="color: var(--ink-2)">Off</strong> and nothing changes: Harmony keeps using
			the deterministic parsing it already ships with.
		</p>
	</section>

	<form
		method="POST"
		action="?/save"
		use:submit={{ success: 'Intelligence settings saved', reset: false }}
	>
		<section class="card space-y-4 p-5">
			<!-- Mode -->
			<div>
				<p class="section-label mb-2">Assist source</p>
				<div
					class="grid grid-cols-3 gap-1 rounded-xl p-1"
					style="background: color-mix(in oklab, var(--ink) 5%, transparent)"
				>
					{#each MODES as m (m.value)}
						<label
							class="press cursor-pointer rounded-lg py-2 text-center text-[14px] font-medium"
							style="background: {mode === m.value
								? 'var(--surface)'
								: 'transparent'}; color: {mode === m.value
								? 'var(--ink)'
								: 'var(--ink-3)'}; box-shadow: {mode === m.value
								? 'inset 0 0 0 1px var(--hairline)'
								: 'none'}"
						>
							<input
								type="radio"
								name="mode"
								value={m.value}
								bind:group={mode}
								disabled={!owner}
								class="sr-only"
							/>
							{m.label}
						</label>
					{/each}
				</div>
				<p class="mt-2 text-[12px] leading-relaxed" style="color: var(--ink-3)">
					{#if mode === 'off'}
						Deterministic only. No model is contacted.
					{:else if mode === 'local'}
						A model on your own machine over the Ollama API. Nothing leaves your server.
					{:else}
						Any OpenAI-compatible API. Text you send is processed by a third party, so use this only
						if you're comfortable with that trade.
					{/if}
				</p>
			</div>

			{#if mode !== 'off'}
				<div>
					<label class="section-label" for="endpoint">Endpoint</label>
					<input
						id="endpoint"
						name="endpoint"
						bind:value={endpoint}
						disabled={!owner}
						placeholder={mode === 'local' ? 'http://localhost:11434' : 'https://api.openai.com'}
						class="field mt-1 font-mono text-[16px]"
					/>
				</div>
				<div>
					<label class="section-label" for="model">Model</label>
					{#if mode === 'local' && availableModels.length > 0}
						<!--
							A list rather than a <select>: an <option> can only hold text, and
							what a model can do is the thing you're choosing on. The chips are
							shown only where Ollama positively said so — an older server
							reports nothing, and nothing is what we draw, because an empty
							row would read as "this model can't", which is a different and
							wrong claim.
						-->
						<div
							class="card mt-1 max-h-[19rem] overflow-y-auto"
							role="radiogroup"
							aria-label="Model"
						>
							{#each availableModels as m, i (m.name)}
								<label
									class="press flex cursor-pointer items-start gap-2.5 p-3 {i > 0 ? 'rule' : ''}"
									style="background: {model === m.name
										? 'color-mix(in oklab, var(--ws-accent) 8%, transparent)'
										: 'transparent'}"
								>
									<input
										type="radio"
										name="model"
										value={m.name}
										checked={model === m.name}
										onchange={() => (model = m.name)}
										disabled={!owner}
										class="mt-0.5 shrink-0"
									/>
									<span class="min-w-0 flex-1">
										<span class="block font-mono text-[14px] break-all" style="color: var(--ink)">
											{m.name}
										</span>
										{#if m.parameterSize || m.quantization}
											<span class="mt-0.5 block text-[11px]" style="color: var(--ink-3)">
												{[m.parameterSize, m.quantization].filter(Boolean).join(' · ')}
											</span>
										{/if}
										{#if m.capabilities && m.capabilities.length > 0}
											<span class="mt-1.5 flex flex-wrap gap-1">
												{#each m.capabilities as cap (cap)}
													<span
														class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.04em]"
														style="background: color-mix(in oklab, {capTone(
															cap
														)} 14%, var(--surface)); color: {capTone(cap)}"
													>
														{cap}
													</span>
												{/each}
											</span>
										{/if}
									</span>
								</label>
							{/each}
						</div>
					{:else}
						<input
							id="model"
							name="model"
							bind:value={model}
							disabled={!owner}
							placeholder={mode === 'local' ? 'Connect to list models' : 'gpt-4o-mini'}
							class="field mt-1 font-mono text-[16px]"
						/>
					{/if}
				</div>
				{#if mode === 'external'}
					<div>
						<label class="section-label" for="apiKey">API key</label>
						<input
							id="apiKey"
							name="apiKey"
							type="password"
							bind:value={apiKey}
							disabled={!owner}
							placeholder={data.config.apiKeySet ? 'Stored. Leave blank to keep it.' : 'sk-...'}
							class="field mt-1 font-mono text-[16px]"
						/>
					</div>
					<p class="text-[12.5px] leading-relaxed" style="color: var(--ink-3)">
						No capability chips here: an OpenAI-compatible endpoint lists model names and nothing
						more, so we never learn what yours can do. We don't guess — features that need something
						specific are offered anyway, and if the model can't do it you'll see your provider's own
						error rather than ours.
					</p>
				{/if}
			{/if}

			{#if form && 'error' in form && form.error}
				<p class="flex items-center gap-1.5 text-[13px]" style="color: var(--deny)">
					<CircleAlert class="h-4 w-4" />
					{form.error}
				</p>
			{/if}

			{#if testResult}
				<p
					class="flex items-center gap-1.5 text-[13px]"
					style="color: {testResult.ok ? 'var(--approve)' : 'var(--deny)'}"
				>
					{#if testResult.ok}<Check class="h-4 w-4" />{:else}<CircleAlert class="h-4 w-4" />{/if}
					{testResult.detail}
				</p>
			{/if}

			{#if owner}
				<!--
					Connect reuses whatever it already knows about each model, keyed on
					the model's own timestamp, so a repeat connect is one request.
					Refresh is for the case that can't be detected from here — you just
					pulled or replaced a model — and drops what's cached for this
					endpoint. Hence two buttons rather than one that always refetches.
				-->
				<div class="flex flex-wrap items-center gap-2 pt-1">
					<button class="btn btn-accent px-4 py-2 text-[14px]">Save</button>
					{#if mode !== 'off'}
						<button formaction="?/test" class="btn btn-ghost px-4 py-2 text-[14px]">
							{mode === 'local' ? 'Connect' : 'Test connection'}
						</button>
					{/if}
					{#if mode === 'local' && availableModels.length > 0}
						<button
							formaction="?/test"
							name="refresh"
							value="true"
							class="btn btn-ghost inline-flex items-center gap-1.5 px-4 py-2 text-[14px]"
						>
							<RefreshCw class="h-3.5 w-3.5" /> Refresh models
						</button>
					{/if}
				</div>
			{:else}
				<p class="text-[13px]" style="color: var(--ink-3)">
					Only the workspace owner can change these settings.
				</p>
			{/if}
		</section>
	</form>

	<section class="card flex items-start gap-2.5 p-4" style="color: var(--ink-3)">
		<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0" style="color: var(--approve)" />
		<p class="text-[12px] leading-relaxed">
			Whatever you choose, the model is only ever a suggestion engine. It cannot approve, spend, or
			change a number on its own, and the app runs exactly the same with it turned off.
		</p>
	</section>
</div>
