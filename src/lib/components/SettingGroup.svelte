<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import Toggle from '$lib/components/Toggle.svelte';

	/**
	 * A settings card whose switch is also its disclosure.
	 *
	 * The settings screens had grown a pattern of showing every field a feature
	 * owns whether or not the feature was on: the whole ntfy form sat there for
	 * people who never intend to run ntfy, and the endpoint and model pickers sat
	 * there with AI assistance off. Reading a settings page should tell you what
	 * is switched on, and only then what it was configured with.
	 *
	 * So the switch is the gate. Off, the card is one line and its description.
	 * On, its own settings slide in beneath. There is no second "expand" affordance
	 * to hunt for, because the thing you already wanted to press is the one that
	 * opens it.
	 *
	 * `on` is the truth to display. `flag` writes a workspace boolean; `onToggle`
	 * persists it some other way. Passing neither makes the switch local to the
	 * page, which is what the groups that only reveal fields want: the fields
	 * they reveal carry their own save.
	 */
	let {
		title,
		description,
		icon,
		on,
		flag,
		onToggle,
		/** Hide the switch entirely (a viewer who may look but not change). */
		readonly = false,
		disabled = false,
		/** Shown beside the title, e.g. an Alpha marker. */
		badge,
		/** The settings themselves, revealed when this is on. */
		children,
		/** Always visible, under the description. For a warning that gates setup. */
		note
	}: {
		title: string;
		description?: string;
		icon?: Component<{ class?: string; style?: string }>;
		on: boolean;
		flag?: string;
		onToggle?: (next: boolean) => void | Promise<void>;
		readonly?: boolean;
		disabled?: boolean;
		badge?: Snippet;
		children?: Snippet;
		note?: Snippet;
	} = $props();
</script>

<section class="card p-5">
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0">
			<h2
				class="flex flex-wrap items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
				style="color: var(--ink)"
			>
				{#if icon}
					{@const Icon = icon}
					<Icon class="h-4 w-4 shrink-0" style="color: var(--ws-accent)" />
				{/if}
				{title}
				{#if badge}{@render badge()}{/if}
			</h2>
			{#if description}
				<p class="mt-1 text-[13px] leading-relaxed" style="color: var(--ink-3)">{description}</p>
			{/if}
			{#if note}{@render note()}{/if}
		</div>
		{#if !readonly}
			<Toggle {on} {flag} {onToggle} {disabled} label="Toggle {title}" />
		{/if}
	</div>

	<!--
		Height, not opacity: the card below has to move out of the way, and a
		fade would leave it jumping. Reduced motion gets the same content with no
		travel, which is the whole of what the preference asks for here.
	-->
	{#if on && children}
		<div
			class="mt-4 border-t pt-4"
			style="border-color: var(--hairline)"
			transition:slide={{ duration: prefersReducedMotion.current ? 0 : 180 }}
		>
			{@render children()}
		</div>
	{/if}
</section>
