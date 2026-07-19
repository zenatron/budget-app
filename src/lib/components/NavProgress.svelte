<script lang="ts">
	import { navigating } from '$app/state';

	// Only for navigations slow enough to notice. Flashing a bar on every instant
	// client-side transition reads as jank, not as feedback.
	const DELAY_MS = 180;

	let visible = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const t = setTimeout(() => (visible = true), DELAY_MS);
		return () => clearTimeout(t);
	});
</script>

{#if visible}
	<div
		class="pointer-events-none fixed top-0 right-0 left-0 z-[60] h-[2px] overflow-hidden"
		role="progressbar"
		aria-label="Loading page"
	>
		<div class="nav-progress h-full w-full" style="background: var(--accent)"></div>
	</div>
{/if}

<style>
	.nav-progress {
		transform-origin: left;
		animation: nav-progress 1.4s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
	}

	@keyframes nav-progress {
		0% {
			transform: scaleX(0);
			opacity: 1;
		}
		70% {
			transform: scaleX(0.85);
		}
		100% {
			transform: scaleX(1);
			opacity: 0.4;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-progress {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
