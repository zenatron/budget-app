<script lang="ts">
	import '@fontsource-variable/hanken-grotesk';
	// Both faces: the display font is used at semibold in 8 places, and with only
	// the 400 loaded the browser was synthesizing a smeared faux-bold.
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/atkinson-hyperlegible/700.css';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	/*
	 * Pinch-zoom, in the installed app only.
	 *
	 * An app you added to your home screen should feel like an app, and pinching
	 * the ledger to 3x leaves you stranded in a corner of a layout that was
	 * already built for the phone. But zoom is also how some people read, so this
	 * is deliberately *not* done in the viewport meta: `user-scalable=no` there
	 * would follow the site into Android browsers too. Gated on display-mode
	 * instead, a browser tab keeps pinch-zoom on every platform, and only the
	 * standalone window loses it.
	 *
	 * `gesturestart` and friends are Safari's own multi-touch events, which is
	 * the lever iOS actually responds to — it has ignored `user-scalable=no` in
	 * the browser since iOS 10. Double-tap-to-zoom is already handled by
	 * `touch-action: manipulation` on html (layout.css).
	 */
	onMount(() => {
		const standalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;
		if (!standalone) return;

		const block = (e: Event) => e.preventDefault();
		const events = ['gesturestart', 'gesturechange', 'gestureend'];
		for (const type of events) {
			document.addEventListener(type, block, { passive: false });
		}
		return () => {
			for (const type of events) document.removeEventListener(type, block);
		};
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<NavProgress />
{@render children()}
<Toaster />
