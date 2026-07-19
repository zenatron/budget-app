<script lang="ts">
	import '@fontsource-variable/hanken-grotesk';
	import '@fontsource/atkinson-hyperlegible';
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
