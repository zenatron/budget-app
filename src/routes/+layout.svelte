<script lang="ts">
	import '@fontsource-variable/hanken-grotesk';
	import '@fontsource/atkinson-hyperlegible';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
