<script lang="ts">
	// Apple Card–style progress ring. Draws on from empty on mount.
	let {
		value = 0,
		size = 128,
		stroke = 13,
		color = 'var(--accent)',
		track = 'var(--surface-2)',
		children
	}: {
		value?: number;
		size?: number;
		stroke?: number;
		color?: string;
		track?: string;
		children?: import('svelte').Snippet;
	} = $props();

	const r = $derived((size - stroke) / 2);
	const circ = $derived(2 * Math.PI * r);
	const target = $derived(Math.max(0, Math.min(1, value)));

	let shown = $state(0);
	$effect(() => {
		const v = target;
		let id2 = 0;
		const id = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => (shown = v));
		});
		return () => {
			cancelAnimationFrame(id);
			if (id2) cancelAnimationFrame(id2);
		};
	});
</script>

<div style="position:relative;width:{size}px;height:{size}px">
	<svg width={size} height={size} viewBox="0 0 {size} {size}" style="transform:rotate(-90deg)">
		<circle cx={size / 2} cy={size / 2} {r} fill="none" stroke={track} stroke-width={stroke} />
		<circle
			cx={size / 2}
			cy={size / 2}
			{r}
			fill="none"
			stroke={color}
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray={circ}
			stroke-dashoffset={circ * (1 - shown)}
			style="transition:stroke-dashoffset 950ms var(--ease-out)"
		/>
	</svg>
	{#if children}
		<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
			{@render children()}
		</div>
	{/if}
</div>
