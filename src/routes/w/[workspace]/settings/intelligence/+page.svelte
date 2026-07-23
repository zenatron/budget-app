<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import Toggle from '$lib/components/Toggle.svelte';
	import { ChevronLeft, Check, CircleAlert, Sparkles, ShieldCheck } from '@lucide/svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	const owner = $derived(data.isOwner);

	// Initial form value; the user then drives it. Intentionally captured once.
	// svelte-ignore state_referenced_locally
	let mode = $state<'off' | 'local' | 'external'>(data.config.mode);
	const MODES = [
		{ value: 'off', label: 'Off' },
		{ value: 'local', label: 'Local' },
		{ value: 'external', label: 'External' }
	] as const;

	const testResult = $derived(form && 'test' in form ? form.test : null);
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

	<!-- The deterministic suite: master switch + the features it powers. -->
	<div class="card flex items-start justify-between gap-4 p-4">
		<div>
			<p class="flex items-center gap-2 text-[15px] font-medium" style="color: var(--ink)">
				Harmony
				<span
					class="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
					style="background: color-mix(in oklab, var(--pending) 16%, var(--surface)); color: var(--pending)"
					>Alpha</span
				>
			</p>
			<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Works out what's genuinely safe to spend this month, and answers questions about your money
				in plain language.
			</p>
			<a
				href="/w/{slug}/settings/help?s=safe-to-spend"
				class="press mt-1 inline-block text-[13px] font-medium"
				style="color: var(--ws-accent)">How it works</a
			>
		</div>
		{#if owner}
			<Toggle on={data.intelligenceEnabled} action="?/intelligence" label="Toggle Harmony" />
		{/if}
	</div>

	<div class="card flex items-center justify-between gap-4 p-4">
		<div>
			<p class="text-[15px] font-medium" style="color: var(--ink)">Read bills from PDFs</p>
			<p class="mt-0.5 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				Prefills a purchase from a bill PDF. It guesses, so it always asks you to confirm.
			</p>
		</div>
		{#if owner}
			<Toggle
				on={data.billImportEnabled}
				action="?/billImport"
				label="Toggle reading bills from PDFs"
			/>
		{/if}
	</div>

	<p class="section-label px-1 pt-2">AI assistance</p>

	<!-- What this is, and the line it never crosses. -->
	<section class="card p-5">
		<h2
			class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			<Sparkles class="h-4 w-4" style="color: var(--accent)" /> A helper, never a decider
		</h2>
		<p class="mt-2 text-[13px] leading-relaxed" style="color: var(--ink-2)">
			Harmony works entirely on plain arithmetic and pattern matching. You can optionally let a
			language model help with the fuzzy parts, like reading a cryptic bank line into a merchant
			name or suggesting a category. It only ever <strong style="color: var(--ink)">suggests</strong
			>: it never approves a purchase, moves money, or decides your Safe to Spend. Every suggestion
			is checked against the app's own options before you see it, so a bad answer becomes no answer.
		</p>
		<p class="mt-2 text-[13px] leading-relaxed" style="color: var(--ink-3)">
			Leave it <strong style="color: var(--ink-2)">Off</strong> and nothing changes: Harmony keeps
			using the deterministic parsing it already ships with.
		</p>
	</section>

	<form method="POST" action="?/save" use:submit={{ success: 'Intelligence settings saved' }}>
		<section class="card space-y-4 p-5">
			<!-- Mode -->
			<div>
				<p class="section-label mb-2">Assist source</p>
				<div
					class="grid grid-cols-3 gap-1 rounded-xl p-1"
					style="background: color-mix(in oklab, var(--ink) 5%, transparent)"
				>
					{#each MODES as m}
						<label
							class="press cursor-pointer rounded-lg py-2 text-center text-[14px] font-medium"
							style="background: {mode === m.value ? 'var(--surface)' : 'transparent'}; color: {mode ===
							m.value
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
						value={data.config.endpoint}
						disabled={!owner}
						placeholder={mode === 'local' ? 'http://localhost:11434' : 'https://api.openai.com'}
						class="field mt-1 font-mono text-[15px]"
					/>
				</div>
				<div>
					<label class="section-label" for="model">Model</label>
					<input
						id="model"
						name="model"
						value={data.config.model}
						disabled={!owner}
						placeholder={mode === 'local' ? 'llama3.2' : 'gpt-4o-mini'}
						class="field mt-1 font-mono text-[15px]"
					/>
				</div>
				{#if mode === 'external'}
					<div>
						<label class="section-label" for="apiKey">API key</label>
						<input
							id="apiKey"
							name="apiKey"
							type="password"
							disabled={!owner}
							placeholder={data.config.apiKeySet ? 'Stored. Leave blank to keep it.' : 'sk-...'}
							class="field mt-1 font-mono text-[15px]"
						/>
					</div>
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
					{#if testResult.ok}<Check class="h-4 w-4" />{:else}<CircleAlert
							class="h-4 w-4"
						/>{/if}
					{testResult.detail}
				</p>
			{/if}

			{#if owner}
				<div class="flex items-center gap-2 pt-1">
					<button class="btn btn-accent px-4 py-2 text-[14px]">Save</button>
					{#if mode !== 'off'}
						<button formaction="?/test" class="btn btn-ghost px-4 py-2 text-[14px]"
							>Test connection</button
						>
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
