<script lang="ts">
	/**
	 * A checkbox that explains itself — label above, consequence below. Used for
	 * the form options where the box alone doesn't say enough ("backfill", "same
	 * amount every time").
	 *
	 * The hint describes what the option DOES, not what state it's in. Wording it
	 * as a state ("Starts from the next occurrence only") reads as a description
	 * of the current setting, so people can't tell whether they're looking at the
	 * before or the after.
	 *
	 * The whole thing is one <label>, so the hint text is part of the tap target.
	 */
	let {
		checked = $bindable(false),
		label,
		hint,
		name,
		value,
		disabled = false
	}: {
		checked?: boolean;
		label: string;
		hint?: string;
		name?: string;
		value?: string;
		disabled?: boolean;
	} = $props();
</script>

<label
	class="-m-1 flex items-start gap-2.5 p-1 {disabled ? 'cursor-default' : 'cursor-pointer'}"
	style={disabled ? 'opacity: 0.55' : ''}
>
	<input type="checkbox" bind:checked {name} {value} {disabled} class="mt-0.5" />
	<span class="text-[15px]" style="color: var(--ink-2)">
		{label}
		{#if hint}
			<span class="mt-0.5 block text-[13px]" style="color: var(--ink-4)">{hint}</span>
		{/if}
	</span>
</label>
