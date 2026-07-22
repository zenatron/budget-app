<script lang="ts">
	import { onMount } from 'svelte';

	// Binds the chosen duration in days (0.5 = "1 night"). The parent submits it;
	// the server turns it into a wake time.
	// eslint-disable-next-line no-useless-assignment -- $bindable: the local write is the binding
	let { amountMinor, days = $bindable(3) }: { amountMinor: bigint; days?: number } = $props();

	type Stop = { label: string; sub: string; days: number; night?: boolean };
	const STOPS: Stop[] = [
		{ label: '1 night', sub: 'Decide in the morning', days: 0.5, night: true },
		{ label: '2 days', sub: 'A couple of days', days: 2 },
		{ label: '3 days', sub: 'A few days to be sure', days: 3 },
		{ label: '5 days', sub: 'Time to think it over', days: 5 },
		{ label: '1 week', sub: 'A week to decide', days: 7 },
		{ label: '10 days', sub: 'No rush', days: 10 },
		{ label: '2 weeks', sub: 'Best for big purchases', days: 14 }
	];
	const N = STOPS.length;
	const ROW = 52;
	const ANGLE = 24;
	const HALF = 2;

	// Bigger buys, a longer wait.
	function defaultIndex(minor: bigint): number {
		const d = Number(minor) / 100;
		if (d <= 25) return 0;
		if (d <= 75) return 1;
		if (d <= 150) return 2;
		if (d <= 350) return 3;
		if (d <= 750) return 4;
		return 6;
	}

	let whyText = $state('');
	let resultText = $state('');
	let selIndex = $state(2);
	let wheelEl: HTMLDivElement;
	let rowEls: HTMLLIElement[] = [];

	const reduce =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function fmtWake(s: Stop): string {
		if (s.night) return 'Wakes tomorrow morning';
		const t = Date.now() + Math.ceil(s.days) * 86_400_000;
		const wd = new Date(t).toLocaleDateString(undefined, { weekday: 'short' });
		const md = new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		return `Wakes ${wd}, ${md}`;
	}

	function setSelected(i: number) {
		const s = STOPS[i];
		days = s.days;
		selIndex = i;
		const isDefault = i === defaultIndex(amountMinor);
		whyText = s.sub + (isDefault ? ' · suggested for this amount' : '');
		resultText = fmtWake(s);
	}

	// svelte-ignore state_referenced_locally
	let pos = defaultIndex(amountMinor);
	let lastCentered = Math.round(pos);

	function render() {
		for (let i = 0; i < N; i++) {
			const d = i - pos;
			const ad = Math.abs(d);
			const rot = Math.max(-90, Math.min(90, -d * ANGLE));
			const op = ad > HALF + 0.55 ? 0 : Math.max(0, 1 - ad * 0.32);
			const el = rowEls[i];
			if (!el) continue;
			el.style.transform =
				'translateY(calc(-50% + ' +
				(d * ROW).toFixed(2) +
				'px)) rotateX(' +
				rot.toFixed(2) +
				'deg)';
			el.style.opacity = op.toFixed(3);
			el.classList.toggle('center', Math.round(pos) === i);
		}
		const c = Math.max(0, Math.min(N - 1, Math.round(pos)));
		if (c !== lastCentered) {
			lastCentered = c;
			if (!reduce && rowEls[c]) {
				rowEls[c].classList.remove('knock');
				void rowEls[c].offsetWidth;
				rowEls[c].classList.add('knock');
			}
			setSelected(c);
		}
	}

	onMount(() => {
		// ---- physics (drag → momentum → snap) ----
		let phase: 'idle' | 'drag' | 'fling' | 'settle' = 'idle';
		let vel = 0;
		let target = pos;
		let startY = 0;
		let startPos = 0;
		let lastY = 0;
		let lastT = 0;
		let raf: number | null = null;
		let prevT = 0;

		const clampSoft = (p: number) =>
			p < 0 ? p * 0.35 : p > N - 1 ? N - 1 + (p - (N - 1)) * 0.35 : p;

		function loop(now: number) {
			const dt = Math.min(32, now - (prevT || now));
			prevT = now;
			if (phase === 'fling') {
				pos += vel * dt;
				vel *= Math.pow(0.9, dt / 16.67);
				if (pos < -0.4 || pos > N - 0.6 || Math.abs(vel) < 0.0018) {
					target = Math.max(0, Math.min(N - 1, Math.round(pos)));
					phase = 'settle';
				}
				render();
				raf = requestAnimationFrame(loop);
			} else if (phase === 'settle') {
				pos += (target - pos) * (reduce ? 1 : 0.2);
				if (Math.abs(target - pos) < 0.002) {
					pos = target;
					render();
					phase = 'idle';
					raf = null;
					return;
				}
				render();
				raf = requestAnimationFrame(loop);
			} else {
				raf = null;
			}
		}
		function start() {
			if (raf) cancelAnimationFrame(raf);
			prevT = 0;
			raf = requestAnimationFrame(loop);
		}
		function settleTo(i: number) {
			target = Math.max(0, Math.min(N - 1, i));
			phase = 'settle';
			start();
		}

		const onDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			wheelEl.setPointerCapture(e.pointerId);
			phase = 'drag';
			startY = lastY = e.clientY;
			startPos = pos;
			lastT = performance.now();
			vel = 0;
			if (raf) {
				cancelAnimationFrame(raf);
				raf = null;
			}
		};
		const onMove = (e: PointerEvent) => {
			if (phase !== 'drag') return;
			const now = performance.now();
			pos = clampSoft(startPos - (e.clientY - startY) / ROW);
			const dt = now - lastT;
			if (dt > 0) vel = (-(e.clientY - lastY) / ROW / dt) * 0.85 + vel * 0.15;
			lastY = e.clientY;
			lastT = now;
			render();
		};
		const onUp = () => {
			if (phase !== 'drag') return;
			if (Math.abs(vel) > 0.004) phase = 'fling';
			else {
				target = Math.max(0, Math.min(N - 1, Math.round(pos)));
				phase = 'settle';
			}
			start();
		};
		let wheelT: ReturnType<typeof setTimeout>;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (raf) {
				cancelAnimationFrame(raf);
				raf = null;
			}
			pos = Math.max(0, Math.min(N - 1, pos + e.deltaY / 200));
			phase = 'idle';
			render();
			clearTimeout(wheelT);
			wheelT = setTimeout(() => settleTo(Math.round(pos)), 90);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			e.preventDefault();
			settleTo(Math.round(pos) + (e.key === 'ArrowDown' ? 1 : -1));
		};

		wheelEl.addEventListener('pointerdown', onDown);
		wheelEl.addEventListener('pointermove', onMove);
		wheelEl.addEventListener('pointerup', onUp);
		wheelEl.addEventListener('pointercancel', onUp);
		wheelEl.addEventListener('wheel', onWheel, { passive: false });
		wheelEl.addEventListener('keydown', onKey);

		// Reveal: mount a touch off the default, then settle onto it.
		setSelected(Math.round(pos));
		render();
		if (!reduce) pos = defaultIndex(amountMinor) + 1.35;
		requestAnimationFrame(() => settleTo(defaultIndex(amountMinor)));

		return () => {
			if (raf) cancelAnimationFrame(raf);
			wheelEl.removeEventListener('pointerdown', onDown);
			wheelEl.removeEventListener('pointermove', onMove);
			wheelEl.removeEventListener('pointerup', onUp);
			wheelEl.removeEventListener('pointercancel', onUp);
			wheelEl.removeEventListener('wheel', onWheel);
			wheelEl.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="picker">
	<div
		class="wheel"
		bind:this={wheelEl}
		tabindex="0"
		role="slider"
		aria-label="How long to sleep on it"
		aria-valuemin="0"
		aria-valuemax={N - 1}
		aria-valuenow={selIndex}
		aria-valuetext={STOPS[selIndex].label}
	>
		<div class="detent"></div>
		<ul class="drum">
			{#each STOPS as s, i (s.label)}
				<li class="row" bind:this={rowEls[i]}><span class="pop">{s.label}</span></li>
			{/each}
		</ul>
	</div>
	<p class="why">{whyText}</p>
	<p class="result">{resultText}</p>
</div>

<style>
	.picker {
		user-select: none;
	}
	.wheel {
		--row: 52px;
		position: relative;
		height: calc(var(--row) * 5);
		perspective: 850px;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
		outline: none;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			#000 24%,
			#000 76%,
			transparent 100%
		);
		mask-image: linear-gradient(to bottom, transparent 0%, #000 24%, #000 76%, transparent 100%);
	}
	.wheel:active {
		cursor: grabbing;
	}
	.wheel:focus-visible {
		box-shadow: 0 0 0 2px var(--seal);
		border-radius: var(--r-md);
	}
	.detent {
		position: absolute;
		inset-inline: 6px;
		top: 50%;
		height: var(--row);
		transform: translateY(-50%);
		border-top: 1px solid var(--hairline-strong);
		border-bottom: 1px solid var(--hairline-strong);
		background: var(--surface-2);
		border-radius: var(--r-sm);
		pointer-events: none;
	}
	.drum {
		position: absolute;
		inset: 0;
		list-style: none;
		margin: 0;
		padding: 0;
		transform-style: preserve-3d;
		pointer-events: none;
	}
	.row {
		position: absolute;
		inset-inline: 0;
		top: 50%;
		height: var(--row);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 19px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		color: var(--ink-4);
		backface-visibility: hidden;
		will-change: transform, opacity;
	}
	/* .center / .knock are toggled imperatively during the drag, so scope them
	   through :global within the (scoped) .picker root — otherwise the compiler
	   prunes them as unused. */
	.picker :global(.row.center) {
		color: var(--ink);
		font-weight: 700;
		font-size: 22px;
	}
	.pop {
		display: inline-block;
	}
	.picker :global(.row.center.knock .pop) {
		animation: knock 0.16s ease-out;
	}
	@keyframes knock {
		0% {
			transform: scale(1);
		}
		45% {
			transform: scale(1.08);
		}
		100% {
			transform: scale(1);
		}
	}
	.why {
		text-align: center;
		font-size: 13px;
		color: var(--ink-3);
		margin: 8px 0 0;
		min-height: 18px;
	}
	.result {
		text-align: center;
		font-size: 13px;
		font-weight: 500;
		color: color-mix(in oklab, var(--seal) 80%, var(--ink));
		margin: 4px 0 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.row {
			animation: none !important;
		}
	}
</style>
