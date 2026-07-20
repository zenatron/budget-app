<script lang="ts">
	/**
	 * The settings switch: a submit button that posts the flipped value, styled as
	 * an iOS-style pill. Lives inside the caller's <form action=…>.
	 *
	 * Geometry is deliberate. The track is 44×28 and the knob 20, so centring
	 * leaves 4px above and below it — and the horizontal inset is set to the same
	 * 4px (translate 4 → 20) so the knob sits an equal distance from every edge.
	 * The old inline version used a 2px horizontal inset, which read as the knob
	 * crowding the left/right ends against a roomier top and bottom.
	 */
	const TRACK_W = 44;
	const KNOB = 20;
	const INSET = 4; // = (track height 28 − knob 20) / 2, so all four gaps match
	const ON_X = TRACK_W - KNOB - INSET; // 20

	let {
		on,
		name = 'enabled',
		label,
		onColor = 'var(--approve)'
	}: {
		on: boolean;
		/** Submitted form field name. */
		name?: string;
		/** Accessible label — the switch has no visible text of its own. */
		label: string;
		onColor?: string;
	} = $props();
</script>

<button
	{name}
	value={on ? 'false' : 'true'}
	role="switch"
	aria-checked={on}
	aria-label={label}
	class="press relative inline-flex h-7 w-11 items-center rounded-full transition-colors"
	style="background: {on ? onColor : 'var(--surface-hi)'}"
>
	<span
		class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
		style="transform: translateX({on ? `${ON_X}px` : `${INSET}px`})"
	></span>
</button>
