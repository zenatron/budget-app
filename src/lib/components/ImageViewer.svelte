<script lang="ts">
	/**
	 * Full-screen look at a photo or a bill page.
	 *
	 * The list and the detail hero both have to fit a photo into a layout, so a
	 * tall receipt is always compromised somewhere. This is the one place it
	 * isn't: the image gets the whole screen at its own shape.
	 *
	 * Deep ink rather than black — the app is light throughout and a pure black
	 * field reads as a different application. Dark enough that the photo is what
	 * your eye lands on, warm enough that it still belongs here.
	 */
	import Icon from '$lib/components/Icon.svelte';

	let {
		src,
		alt = '',
		open = $bindable(false)
	}: { src: string; alt?: string; open?: boolean } = $props();

	let dialog: HTMLDialogElement | null = $state(null);

	/*
	 * <dialog showModal> rather than a hand-rolled overlay: the platform gives
	 * focus trapping, Escape, inertness of the page behind, and the top layer
	 * (so nothing can z-index its way over it) for free. Re-implementing those is
	 * where accessible modals usually go wrong.
	 */
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	class="max-h-none max-w-none border-none bg-transparent p-0"
	style="width: 100vw; height: 100dvh"
	aria-label={alt || 'Photo'}
>
	<div
		class="relative flex h-full w-full items-center justify-center p-4"
		style="background: color-mix(in oklab, var(--ink) 96%, black)"
	>
		<!--
			Tap-anywhere-to-close, as its own element behind the image rather than a
			handler on the image. A click listener on an <img> is unreachable by
			keyboard; Escape and the close button are the accessible ways out, so
			this is a pointer convenience only and stays out of the a11y tree.
		-->
		<button
			onclick={() => (open = false)}
			tabindex="-1"
			aria-hidden="true"
			class="absolute inset-0 cursor-default"
		></button>
		<img
			{src}
			{alt}
			class="pointer-events-none relative max-h-full max-w-full object-contain"
			style="border-radius: 4px"
		/>
	</div>

	<!-- Inside the safe area: on a notched phone a top-right button at inset 0
	     lands under the status bar. -->
	<button
		onclick={() => (open = false)}
		aria-label="Close"
		class="press absolute flex h-10 w-10 items-center justify-center rounded-full backdrop-blur"
		style="top: calc(env(safe-area-inset-top, 0px) + 12px); right: 12px; background: oklch(1 0 0 / 0.16); color: white"
	>
		<Icon name="xmark" class="h-5 w-5" />
	</button>
</dialog>

<style>
	dialog::backdrop {
		background: oklch(0 0 0 / 0.6);
	}
	/* The dialog is the full viewport, so it must not scroll — the image is
	   already bounded by max-height. */
	dialog {
		overflow: hidden;
	}
</style>
