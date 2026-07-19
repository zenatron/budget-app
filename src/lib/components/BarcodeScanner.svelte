<script lang="ts">
	/**
	 * Alpha: point the camera at a barcode, get the number.
	 *
	 * Stage one deliberately stops there — it decodes and hands back the digits,
	 * and does not look anything up. A barcode cannot tell you a price (that is a
	 * property of a shop on a day, not of a product), and product databases cover
	 * general merchandise patchily, so the lookup is a separate decision with its
	 * own trade-offs. This part is worth having on its own: it proves the camera
	 * and the decoder work on the phone you actually carry.
	 *
	 * The shutter is always offered. When a code doesn't read — damaged label, no
	 * barcode at all, a shelf tag — a photo of the thing still tells whoever is
	 * approving it everything they need, and that path already exists.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { Confirmer, isValidEanUpc, type ScanHit } from '$lib/scan/barcode';

	let {
		open = $bindable(false),
		onscan,
		onphoto
	}: {
		open?: boolean;
		onscan: (hit: ScanHit) => void;
		/** Fallback when nothing reads: a still from the same camera. */
		onphoto?: (file: File) => void;
	} = $props();

	let video: HTMLVideoElement | null = $state(null);
	let status: 'idle' | 'starting' | 'scanning' | 'error' = $state('idle');
	let message: string | null = $state(null);
	let engine: string | null = $state(null);

	let stream: MediaStream | null = null;
	let raf = 0;
	let stopped = false;

	async function start() {
		stopped = false;
		status = 'starting';
		message = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
				audio: false
			});
			if (stopped) return stopTracks();
			if (video) {
				video.srcObject = stream;
				await video.play();
			}

			const { createDecoder } = await import('$lib/scan/barcode');
			const decoder = await createDecoder();
			if (stopped) return stopTracks();
			engine = decoder.engine;
			status = 'scanning';

			const confirmer = new Confirmer(2);
			// Reused across frames: allocating a canvas per frame is the single
			// most expensive thing a naive scan loop does.
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			let busy = false;

			const tick = async () => {
				if (stopped || !video || !ctx) return;
				if (!busy && video.videoWidth > 0) {
					busy = true;
					try {
						canvas.width = video.videoWidth;
						canvas.height = video.videoHeight;
						ctx.drawImage(video, 0, 0);
						const hits = await decoder.decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
						for (const hit of hits) {
							// A checksum failure is a misread, not a product.
							if (/^\d+$/.test(hit.value) && !isValidEanUpc(hit.value)) continue;
							if (confirmer.offer(hit.value)) {
								stop();
								onscan(hit);
								return;
							}
						}
					} catch {
						/* a bad frame is normal; the next one usually reads */
					}
					busy = false;
				}
				raf = requestAnimationFrame(() => void tick());
			};
			void tick();
		} catch (e) {
			status = 'error';
			message =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Camera access was declined. You can still add a photo or type it in.'
					: 'Could not open the camera on this device.';
		}
	}

	function stopTracks() {
		for (const t of stream?.getTracks() ?? []) t.stop();
		stream = null;
	}

	function stop() {
		stopped = true;
		// onDestroy runs during SSR too, where there is no rAF and no camera —
		// touching either there 500s the whole page rather than failing quietly.
		if (!browser) return;
		cancelAnimationFrame(raf);
		stopTracks();
		status = 'idle';
	}

	/** Grab the current frame as a photo — the universal fallback. */
	async function shoot() {
		if (!video || video.videoWidth === 0) return;
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext('2d')?.drawImage(video, 0, 0);
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9));
		if (!blob) return;
		stop();
		onphoto?.(new File([blob], 'scan.webp', { type: 'image/webp' }));
		open = false;
	}

	function close() {
		stop();
		open = false;
	}

	$effect(() => {
		if (open) void start();
		else stop();
	});

	onDestroy(stop);
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex flex-col"
		style="background: color-mix(in oklab, var(--ink) 96%, black)"
	>
		<div class="relative flex-1 overflow-hidden">
			<video bind:this={video} playsinline muted class="h-full w-full object-cover"></video>

			<!-- Reticle: says where to aim without hiding what the camera sees. -->
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div
					class="h-[28%] w-[78%] rounded-[18px]"
					style="box-shadow: 0 0 0 2px oklch(1 0 0 / 0.85), 0 0 0 100vmax oklch(0 0 0 / 0.45)"
				></div>
			</div>

			<button
				onclick={close}
				aria-label="Close"
				class="press absolute flex h-10 w-10 items-center justify-center rounded-full backdrop-blur"
				style="top: calc(env(safe-area-inset-top, 0px) + 12px); right: 12px; background: oklch(1 0 0 / 0.16); color: white"
			>
				<Icon name="xmark" class="h-5 w-5" />
			</button>
		</div>

		<div
			class="px-5 pt-4 text-center"
			style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px)"
		>
			<p class="text-[15px] font-medium text-white">
				{#if status === 'starting'}
					Starting the camera…
				{:else if status === 'scanning'}
					Point at the barcode
				{:else if status === 'error'}
					{message}
				{:else}
					&nbsp;
				{/if}
			</p>
			<p class="mt-1 text-[13px]" style="color: oklch(1 0 0 / 0.6)">
				{#if status === 'error'}
					&nbsp;
				{:else}
					No barcode? Take a photo of it instead.
				{/if}
			</p>

			{#if onphoto && status === 'scanning'}
				<button
					onclick={shoot}
					class="press mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full"
					style="background: white"
					aria-label="Take a photo instead"
				>
					<Icon name="camera" class="h-7 w-7" style="color: var(--ink)" />
				</button>
			{/if}

			{#if engine}
				<!-- Which decoder ran. Alpha-only: the whole point of stage one is
				     finding out whether the fallback is doing the work on real phones. -->
				<p class="mt-3 text-[11px]" style="color: oklch(1 0 0 / 0.35)">
					{engine === 'native' ? 'Native decoder' : 'WASM decoder'}
				</p>
			{/if}
		</div>
	</div>
{/if}
