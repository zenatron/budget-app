<script lang="ts">
	import Segmented from '$lib/components/Segmented.svelte';
	import DayOfMonthPicker from '$lib/components/DayOfMonthPicker.svelte';

	/**
	 * Income repeats or it doesn't — a far smaller space than a recurring charge,
	 * so it gets its own control rather than a mode flag on RecurrencePicker.
	 *
	 * Emits `repeat`, `date` and `monthDay`, matching what the route already
	 * parses. The day-of-month field only exists when it can matter.
	 */
	let {
		repeat = $bindable('once'),
		date = $bindable(''),
		monthDay = $bindable('1'),
		dateLabel = 'Received on'
	}: { repeat?: string; date?: string; monthDay?: string; dateLabel?: string } = $props();

	const ordinal = (n: number) => {
		const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
		return `${n}${s}`;
	};

	const summary = $derived.by(() => {
		if (repeat !== 'monthly') {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
			const [y, m, d] = date.split('-').map(Number);
			return `One-off on ${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
				month: 'long',
				day: 'numeric',
				year: 'numeric',
				timeZone: 'UTC'
			})}`;
		}
		const day = Number(monthDay);
		return `Every month on the ${day === -1 ? 'last day' : ordinal(day)}`;
	});
</script>

<div class="space-y-4">
	<Segmented
		bind:value={repeat}
		name="repeat"
		label="How often"
		options={[
			{ value: 'once', label: 'One-off' },
			{ value: 'monthly', label: 'Monthly' }
		]}
	/>

	<label class="block">
		<span class="section-label mb-1.5 block">
			{repeat === 'monthly' ? 'Starting' : dateLabel}
		</span>
		<input name="date" type="date" bind:value={date} required class="field text-[16px]" />
	</label>

	{#if repeat === 'monthly'}
		<div><DayOfMonthPicker bind:value={monthDay} name="monthDay" label="Paid on" /></div>
	{/if}

	{#if summary}
		<p
			class="rounded-[12px] px-3.5 py-3 text-[14px]"
			style="background: color-mix(in oklab, var(--ws-accent) 10%, var(--surface-2)); color: var(--ink)"
			aria-live="polite"
		>
			<span class="font-semibold">{summary}</span>
		</p>
	{/if}
</div>
