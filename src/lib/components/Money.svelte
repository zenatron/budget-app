<script lang="ts">
	import { maskAmount } from '$lib/domain/visibility/discretion';
	import { formatMinor } from '$lib/money-format';

	let {
		minor,
		currency,
		sign = false,
		block = false,
		/** Blank the digits — discretion, not secrecy. See domain/visibility/discretion. */
		masked = false,
		class: cls = ''
	}: {
		minor: bigint;
		currency: string;
		sign?: boolean;
		block?: boolean;
		masked?: boolean;
		class?: string;
	} = $props();

	let reduce = $derived(
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: true
	);

	let text = $derived.by(() => {
		const body = formatMinor(minor < 0n ? -minor : minor, currency);
		const prefix = minor < 0n ? '−' : sign ? '+' : '';
		// The sign goes with the digits when masked: a leading − would announce
		// "you're under", which is exactly what the mask is meant to withhold.
		return masked ? maskAmount(body) : prefix + body;
	});
	let chars = $derived([...text]);

	// A per-glyph roll: changed digits rise into place with a slight stagger.
	// Amounts stay tabular so nothing shifts horizontally while they settle.
	function roll(_node: Element, { i }: { i: number }) {
		if (reduce) return {};
		return {
			delay: i * 20,
			duration: 300,
			css: (t: number) => {
				const e = 1 - Math.pow(1 - t, 3);
				return `opacity:${t};transform:translateY(${(1 - e) * 0.5}em)`;
			}
		};
	}
</script>

<span
	class="num {cls}"
	style="overflow:hidden;display:{block ? 'block' : 'inline-flex'}"
	aria-hidden={masked ? 'true' : undefined}
>
	{#each chars as c, i (i + ':' + c)}
		<span in:roll={{ i }} style="display:inline-block;white-space:pre">{c}</span>
	{/each}
</span>
{#if masked}
	<!-- Bullets read as noise to a screen reader; say what's actually there. -->
	<span class="sr-only">Amount hidden</span>
{/if}
