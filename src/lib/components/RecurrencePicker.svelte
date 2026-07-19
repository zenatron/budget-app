<script lang="ts">
	import Segmented from '$lib/components/Segmented.svelte';
	import WeekdayPicker from '$lib/components/WeekdayPicker.svelte';
	import DayOfMonthPicker from '$lib/components/DayOfMonthPicker.svelte';
	import {
		addDays,
		describeRecurrence,
		nextOccurrence,
		type Recurrence
	} from '$lib/domain/recurrence/rrule';

	/**
	 * The whole recurrence in one control, emitting the field names the server
	 * already expects (freq, interval, weekDay, monthDay, startDate) — no route
	 * changes needed.
	 *
	 * Two things it fixes. Only the fields that matter for the chosen cadence are
	 * on screen, instead of five controls competing at once. And it states in
	 * words what will happen, using the same `describeRecurrence` the list uses,
	 * so the preview and the saved rule can't disagree.
	 */
	let {
		freq = $bindable('monthly'),
		interval = $bindable(1),
		weekDays = $bindable<number[]>([]),
		monthDay = $bindable('1'),
		startDate = $bindable('')
	}: {
		freq?: string;
		interval?: number;
		weekDays?: number[];
		monthDay?: string;
		startDate?: string;
	} = $props();

	const unit = $derived(
		{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[freq] ?? 'month'
	);

	// A recurrence built from the current selection, so the sentence below is
	// derived from the same shape the server will store.
	const preview = $derived.by<{ text: string; first: string } | null>(() => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
		const [y, m, d] = startDate.split('-').map(Number);
		const rec: Recurrence = { start: { y, m, d }, freq: freq as Recurrence['freq'], interval };
		if (freq === 'weekly' && weekDays.length > 0) rec.byDay = weekDays;
		if (freq === 'monthly' || freq === 'yearly') rec.byMonthDay = Number(monthDay);
		if (freq === 'yearly') rec.byMonth = m;
		try {
			const next = nextOccurrence(rec, addDays({ y, m, d }, -1));
			const when = new Date(Date.UTC(next.y, next.m - 1, next.d));
			return {
				text: describeRecurrence(rec),
				first: when.toLocaleDateString(undefined, {
					weekday: 'short',
					month: 'long',
					day: 'numeric',
					year: next.y === new Date().getFullYear() ? undefined : 'numeric',
					timeZone: 'UTC'
				})
			};
		} catch {
			return null;
		}
	});
</script>

<div class="space-y-4">
	<div>
		<Segmented
			bind:value={freq}
			name="freq"
			label="Repeats"
			options={[
				{ value: 'daily', label: 'Daily' },
				{ value: 'weekly', label: 'Weekly' },
				{ value: 'monthly', label: 'Monthly' },
				{ value: 'yearly', label: 'Yearly' }
			]}
		/>
	</div>

	<!-- Interval reads as a sentence. A bare number box between a dropdown and a
	     date told you nothing about what the number meant. -->
	<label class="flex items-center gap-2.5">
		<span class="text-[15px]" style="color: var(--ink-2)">Every</span>
		<select
			name="interval"
			bind:value={interval}
			class="field num w-20 py-2 text-[16px]"
			aria-label="Interval"
		>
			{#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}
				<option value={n}>{n}</option>
			{/each}
		</select>
		<span class="text-[15px]" style="color: var(--ink-2)">{unit}{interval === 1 ? '' : 's'}</span>
	</label>

	{#if freq === 'weekly'}
		<div><WeekdayPicker bind:value={weekDays} name="weekDay" /></div>
	{:else if freq === 'monthly' || freq === 'yearly'}
		<div>
			<DayOfMonthPicker
				bind:value={monthDay}
				name="monthDay"
				label={freq === 'yearly' ? 'Day (of the starting month)' : 'Day of month'}
			/>
		</div>
	{/if}

	<label class="block">
		<span class="section-label mb-1.5 block">Starting</span>
		<input name="startDate" type="date" bind:value={startDate} required class="field text-[16px]" />
	</label>

	{#if preview}
		<p
			class="rounded-[12px] px-3.5 py-3 text-[14px] leading-relaxed"
			style="background: color-mix(in oklab, var(--ws-accent) 10%, var(--surface-2)); color: var(--ink-2)"
			aria-live="polite"
		>
			<span class="font-semibold" style="color: var(--ink)">{preview.text}</span><br />
			First charge {preview.first}
		</p>
	{/if}
</div>
