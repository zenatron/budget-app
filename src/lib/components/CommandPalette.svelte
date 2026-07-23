<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import { toggle } from '$lib/command-palette-state.svelte';
</script>

<button
	onclick={toggle}
	class="press flex h-8 w-8 items-center justify-center rounded-full"
	style="background: color-mix(in oklab, var(--ws-accent) 12%, transparent); color: var(--ws-accent)"
	aria-label="Ask Harmony"
>
	<Sparkles class="h-[17px] w-[17px]" />
</button>
