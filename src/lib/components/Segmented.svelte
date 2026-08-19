<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface SegmentedOption {
		value: string;
		label: string;
		/** Present for navigation: the segment renders as a link, not a button. */
		href?: string;
		icon?: Component<{ class?: string }>;
		title?: string;
	}
</script>

<script lang="ts">
	/**
	 * The segmented control — one definition, used everywhere.
	 *
	 * Six hand-rolled copies of this had accumulated (period tabs on Activity and
	 * on the map, Plan's tabs, Appearance, and the two `<select>` replacements)
	 * and they had drifted apart: different radii, different weights, and — the
	 * one that showed — Appearance's selected segment carried only the drop
	 * shadow and not the hairline ring. Without the ring the raised pill has no
	 * top edge against the track, while the shadow still darkens beneath it, so
	 * it reads as though the padding below is smaller than the padding above.
	 * Nothing was actually off-centre; the outline that defines all four edges
	 * was missing.
	 *
	 * Two things are therefore fixed here rather than at each call site: the
	 * selected treatment is one string, and every segment centres its label with
	 * flex rather than relying on the line box, which otherwise leaves half a
	 * pixel of difference top to bottom at some type sizes.
	 *
	 * Replaces `<select>` where the options are few and the choice steers the
	 * rest of a form — a dropdown hides the alternatives behind a tap, which is
	 * what made the recurrence forms feel like a guessing game.
	 */
	let {
		options,
		value = $bindable(),
		label,
		name,
		ariaLabel,
		/** `md` is the default control; `sm` is the tighter one used for periods. */
		size = 'md',
		/** Stretch to fill the row and share width equally, or hug the labels. */
		fill = true,
		/**
		 * Tighter horizontal padding, for a hugging control that sits beside a
		 * heading rather than owning its own row. Only meaningful with `fill`
		 * off — a filled track shares the width out regardless.
		 */
		compact = false,
		/**
		 * Makes each segment a submit button carrying this field name — for the
		 * places where choosing *is* the submit rather than local state.
		 */
		submitName,
		onselect
	}: {
		options: SegmentedOption[];
		value: string;
		label?: string;
		name?: string;
		ariaLabel?: string;
		size?: 'sm' | 'md';
		fill?: boolean;
		compact?: boolean;
		submitName?: string;
		onselect?: (value: string) => void;
	} = $props();

	// Radii nest: the inner radius is the outer minus the track's own padding, so
	// the pill's corners sit concentric inside the track's.
	const S = {
		sm: {
			track: 'rounded-[10px] p-0.5',
			seg: 'rounded-[8px] py-1.5 text-[13px]',
			pad: 'px-3',
			tight: 'px-2'
		},
		md: {
			track: 'rounded-[12px] p-1',
			seg: 'rounded-[9px] py-2 text-[14px]',
			pad: 'px-5',
			tight: 'px-3.5'
		}
	} as const;

	const s = $derived(S[size]);
	const navigational = $derived(options.some((o) => o.href));
	const segClass = $derived(
		`press inline-flex items-center justify-center gap-1.5 font-semibold transition-colors ${s.seg} ${
			fill ? 'flex-1' : compact ? s.tight : s.pad
		}`
	);

	/** The one place the selected treatment is written down. */
	function styleFor(active: boolean): string {
		return active
			? 'color: var(--ink); background: var(--surface); box-shadow: var(--shadow-card), inset 0 0 0 0.5px var(--hairline)'
			: 'color: var(--ink-3); background: transparent; box-shadow: none';
	}
</script>

{#if label}
	<span class="section-label mb-1.5 block">{label}</span>
{/if}

<div
	class="inline-flex {fill ? 'w-full' : ''} {s.track}"
	style="background: var(--surface-2)"
	role={navigational ? 'tablist' : submitName ? 'group' : 'radiogroup'}
	aria-label={ariaLabel ?? label}
>
	{#each options as opt (opt.value)}
		{@const active = value === opt.value}
		{#if opt.href}
			<a
				href={opt.href}
				role="tab"
				aria-selected={active}
				title={opt.title}
				class={segClass}
				style={styleFor(active)}
			>
				{#if opt.icon}<opt.icon class="h-4 w-4" />{/if}
				{opt.label}
			</a>
		{:else if submitName}
			<button
				name={submitName}
				value={opt.value}
				aria-pressed={active}
				title={opt.title}
				class={segClass}
				style={styleFor(active)}
			>
				{#if opt.icon}<opt.icon class="h-4 w-4" />{/if}
				{opt.label}
			</button>
		{:else}
			<button
				type="button"
				role="radio"
				aria-checked={active}
				title={opt.title}
				onclick={() => {
					value = opt.value;
					onselect?.(opt.value);
				}}
				class={segClass}
				style={styleFor(active)}
			>
				{#if opt.icon}<opt.icon class="h-4 w-4" />{/if}
				{opt.label}
			</button>
		{/if}
	{/each}
</div>

{#if name}
	<input type="hidden" {name} {value} />
{/if}
