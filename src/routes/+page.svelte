<script lang="ts">
	import { Wallet } from '@lucide/svelte';
</script>

<svelte:head><title>Ledger</title></svelte:head>

<main
	class="min-h-viewport flex flex-col justify-between gap-8 px-7 py-12"
	style="--ws-accent: #B4472B; --accent: #B4472B"
>
	<div class="flex items-center gap-2.5 pt-4">
		<div
			class="flex h-9 w-9 items-center justify-center rounded-[9px]"
			style="background: var(--ink); color: var(--paper)"
		>
			<Wallet class="h-5 w-5" />
		</div>
		<span class="section-label" style="letter-spacing: 0.18em">The Ledger</span>
	</div>

	<div>
		<h1 class="text-[clamp(3.4rem,3rem+4vw,4.5rem)] leading-[0.92]">
			Spend<br />with<br /><span style="font-style: italic">consensus.</span>
		</h1>
		<p class="mt-5 max-w-[32ch] text-[17px] leading-relaxed" style="color: var(--ink-3)">
			Shared spending, approvals, and budgets — a private ledger for the people you trust.
		</p>
	</div>

	<div>
		<a href="/auth/login" class="btn btn-accent w-full py-4 text-[17px]">Sign in with Pocket ID</a>
		<p class="mt-4 text-center text-[13px]" style="color: var(--ink-4)">
			Self-hosted · Passkey auth
		</p>
	</div>
</main>
