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

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<NavProgress />
{@render children()}
<Toaster />
