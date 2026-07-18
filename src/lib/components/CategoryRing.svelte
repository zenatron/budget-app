<script lang="ts">
	let {
		segments = [] as { value: bigint; color: string }[],
		cap = 0n,
		size = 200,
		stroke = 14,
		track = 'var(--surface-2)',
		gap = 'var(--surface-hi)',
		children
	}: {
		segments?: { value: bigint; color: string }[];
		cap?: bigint;
		size?: number;
		stroke?: number;
		track?: string;
		gap?: string;
		children?: import('svelte').Snippet;
	} = $props();

	const r = $derived((size - stroke) / 2);
	const circ = $derived(2 * Math.PI * r);
	let mounted = $state(false);

	const slices = $derived.by(() => {
		const total = segments.reduce((s, c) => s + c.value, 0n);
		if (total === 0n) return { slices: [], usedFraction: 0, usedAngle: 0 };
		const limit = cap > 0n ? cap : total;
		const usedFraction = Math.min(1, Number(total) / Number(limit));
		let angle = 0;
		const result: { color: string; degrees: number; rotate: number }[] = [];
		for (const s of segments) {
			if (s.value <= 0n) continue;
			const fraction = Number(s.value) / Number(limit);
			const degrees = fraction * 360;
			result.push({ color: s.color, degrees, rotate: angle });
			angle += degrees;
		}
		return { slices: result, usedFraction, usedAngle: angle };
	});

	const gapSlice = $derived.by(() => {
		const { usedFraction, usedAngle } = slices;
		if (usedFraction >= 1) return null;
		return { degrees: 360 - usedAngle, rotate: usedAngle };
	});

	const cx = $derived(size / 2);
	const cy = $derived(size / 2);

	$effect(() => {
		// Two frames so the transition has a from-state to animate out of
		const id = requestAnimationFrame(() => requestAnimationFrame(() => (mounted = true)));
		return () => cancelAnimationFrame(id);
	});
</script>

<div style="position:relative;width:{size}px;height:{size}px">
	<svg width={size} height={size} viewBox="0 0 {size} {size}">
		<circle {cx} {cy} {r} fill="none" stroke={track} stroke-width={stroke} />
		<g transform="rotate(-90 {cx} {cy})">
			{#each slices.slices as s, i (`${s.color}-${i}`)}
				<g transform="rotate({s.rotate} {cx} {cy})">
					<circle
						{cx}
						{cy}
						{r}
						fill="none"
						stroke={s.color}
						stroke-width={stroke}
						stroke-linecap="butt"
						stroke-dasharray="{mounted ? ((s.degrees / 360) * circ).toFixed(2) : '0'} {circ.toFixed(
							2
						)}"
						style="transition:stroke-dasharray 600ms var(--ease-out)"
					/>
				</g>
			{/each}
			{#if gapSlice}
				<g transform="rotate({gapSlice.rotate} {cx} {cy})">
					<circle
						{cx}
						{cy}
						{r}
						fill="none"
						stroke={gap}
						stroke-width={stroke}
						stroke-linecap="butt"
						stroke-dasharray="{mounted
							? ((gapSlice.degrees / 360) * circ).toFixed(2)
							: '0'} {circ.toFixed(2)}"
						style="transition:stroke-dasharray 600ms var(--ease-out)"
					/>
				</g>
			{/if}
		</g>
	</svg>
	{#if children}
		<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
			{@render children()}
		</div>
	{/if}
</div>
