<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { Check, ChevronLeft } from '@lucide/svelte';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

	const mcpUrl = $derived(`${page.url.origin}/mcp`);

	// The just-created secret (shown once). Cleared when the user copies/dismisses.
	let revealed = $state<{ secret: string; name: string } | null>(null);
	$effect(() => {
		if (form?.created) revealed = { secret: form.created.secret, name: form.created.name };
	});

	let copied = $state(false);
	async function copy(textToCopy: string) {
		try {
			await navigator.clipboard.writeText(textToCopy);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard blocked — the value is on screen to copy by hand */
		}
	}

	const SCOPES: { id: string; label: string; hint: string }[] = [
		{ id: 'read', label: 'Read', hint: 'View spending, summaries, and pending items' },
		{ id: 'write', label: 'Log & request', hint: 'Record purchases and ask for approval' },
		{ id: 'approve', label: 'Approve', hint: 'Approve, deny, and complete purchases' }
	];

	function fmtDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
	function scopeLabel(s: string) {
		return SCOPES.find((x) => x.id === s)?.label ?? s;
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
	<h1 class="px-1 text-[28px]">API &amp; MCP</h1>

	<!-- What this is -->
	<div class="card p-4">
		<p class="text-[15px] font-medium" style="color: var(--ink)">Connect your assistant</p>
		<p class="mt-1 text-[13px] leading-relaxed" style="color: var(--ink-3)">
			Add this workspace as an <strong>MCP server</strong> in Claude, ChatGPT, or your editor, and ask
			about your budget in plain language — “how much did we spend on groceries?”, “log $40 at Trader
			Joe’s”, “what’s waiting on my approval?”. It acts as you, so approvals and gift-mode seals still
			apply.
		</p>
		<div class="mt-3">
			<span class="section-label mb-1.5 block">Server URL</span>
			<div class="flex items-center gap-2">
				<code
					class="num flex-1 truncate rounded-[10px] px-3 py-2 text-[13px]"
					style="background: var(--surface-2); color: var(--ink-2)">{mcpUrl}</code
				>
				<button
					type="button"
					onclick={() => copy(mcpUrl)}
					class="btn btn-ghost shrink-0 px-3 py-2 text-[13px]">Copy</button
				>
			</div>
			<p class="mt-1.5 text-[12px]" style="color: var(--ink-4)">
				Authenticate with a token below as <code>Authorization: Bearer …</code>.
			</p>
		</div>
	</div>

	{#if form?.error}
		<div
			class="card p-4 text-[15px]"
			style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface))"
		>
			{form.error}
		</div>
	{/if}

	<!-- Freshly-created secret: shown exactly once -->
	{#if revealed}
		<div
			class="card p-4"
			style="background: color-mix(in oklab, var(--approve) 10%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--approve) 30%, transparent)"
		>
			<p class="flex items-center gap-1.5 text-[14px] font-semibold" style="color: var(--approve)">
				<Check class="h-4 w-4" /> “{revealed.name}” created
			</p>
			<p class="mt-1 text-[13px]" style="color: var(--ink-3)">
				Copy it now — this is the only time it’s shown.
			</p>
			<div class="mt-2.5 flex items-center gap-2">
				<code
					class="num flex-1 truncate rounded-[10px] px-3 py-2 text-[13px]"
					style="background: var(--surface-2); color: var(--ink)">{revealed.secret}</code
				>
				<button
					type="button"
					onclick={() => copy(revealed!.secret)}
					class="btn btn-accent shrink-0 px-3 py-2 text-[13px]">{copied ? 'Copied' : 'Copy'}</button
				>
			</div>
			<button
				type="button"
				onclick={() => (revealed = null)}
				class="btn btn-plain mt-2 px-0 text-[13px]"
				style="color: var(--ink-4)">I’ve saved it — hide</button
			>
		</div>
	{/if}

	<!-- Create -->
	<div class="card p-5">
		<p class="text-[15px] font-medium" style="color: var(--ink)">New token</p>
		<form
			method="POST"
			action="?/create"
			use:submit={{ success: 'Token created' }}
			class="mt-3 space-y-4"
		>
			<label class="block">
				<span class="section-label mb-1.5 block">Name</span>
				<input
					name="name"
					required
					maxlength="60"
					placeholder="e.g. Claude on my phone"
					class="field text-[16px]"
				/>
			</label>

			<fieldset>
				<legend class="section-label mb-2">Permissions</legend>
				<div class="space-y-2">
					{#each SCOPES as s (s.id)}
						<label
							class="flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5"
							style="box-shadow: inset 0 0 0 1px var(--hairline)"
						>
							<input
								type="checkbox"
								name="scopes"
								value={s.id}
								checked
								class="mt-0.5 h-4 w-4 shrink-0"
								style="accent-color: var(--ws-accent)"
							/>
							<span class="min-w-0 flex-1">
								<span class="block text-[15px] font-medium" style="color: var(--ink)"
									>{s.label}</span
								>
								<span class="block text-[13px]" style="color: var(--ink-4)">{s.hint}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="block">
				<span class="section-label mb-1.5 block">Expires</span>
				<select name="expiresInDays" class="field text-[16px]">
					<option value="">Never</option>
					<option value="30">In 30 days</option>
					<option value="90">In 90 days</option>
					<option value="365">In 1 year</option>
				</select>
			</label>

			<button class="btn btn-accent w-full">Create token</button>
		</form>
	</div>

	<!-- Existing tokens -->
	<div>
		<p class="section-label mb-2 px-1">Your tokens</p>
		{#if data.tokens.length === 0}
			<div class="card p-4 text-[14px]" style="color: var(--ink-4)">
				No tokens yet. Create one above to connect a client.
			</div>
		{:else}
			<div class="space-y-2.5">
				{#each data.tokens as t (t.id)}
					<div class="card flex items-center gap-3 p-4">
						<div class="min-w-0 flex-1">
							<p class="truncate text-[15px] font-medium" style="color: var(--ink)">{t.name}</p>
							<p class="num mt-0.5 text-[12px]" style="color: var(--ink-4)">
								{t.prefix}…&nbsp;·&nbsp;{t.scopes.map(scopeLabel).join(', ')}
							</p>
							<p class="mt-0.5 text-[12px]" style="color: var(--ink-4)">
								{t.lastUsedAt ? `Last used ${fmtDate(t.lastUsedAt)}` : 'Never used'}
								{#if t.expiresAt}· expires {fmtDate(t.expiresAt)}{/if}
							</p>
						</div>
						<form
							method="POST"
							action="?/revoke"
							use:submit={{
								confirm: `Revoke “${t.name}”? Any client using it stops working immediately.`,
								success: 'Token revoked'
							}}
						>
							<input type="hidden" name="tokenId" value={t.id} />
							<button
								class="press rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-medium"
								style="color: var(--deny); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--deny) 35%, transparent)"
								>Revoke</button
							>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
