<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import { toggle } from '$lib/command-palette-state.svelte';
</script>

<!--
	Tinted against `--surface`, not `transparent`.
	
	Mixing a tint with `transparent` yields a 12%-alpha fill, which on a card is
	indistinguishable from the opaque version — the card underneath *is* surface.
	This button doesn't sit on a card. It sits on the header, which is `--paper`
	at 82% behind a blur, and paper is darker than surface — so the same recipe
	came out muddier here than the identical chip does anywhere else, and shifted
	as content scrolled under it. An opaque mix makes it match, and hold still.
-->
<button
	onclick={toggle}
	class="press flex h-8 w-8 items-center justify-center rounded-full"
	style="background: color-mix(in oklab, var(--ws-accent) 14%, var(--surface)); color: var(--ws-accent)"
	aria-label="Ask Harmony"
>
	<Sparkles class="h-[17px] w-[17px]" />
</button>
