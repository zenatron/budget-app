<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { ChevronLeft, Monitor, Moon, Palette, Sun, Vibrate } from '@lucide/svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import { theme, setTheme, type ThemePref } from '$lib/theme.svelte';
	import { haptic, haptics, setHaptics } from '$lib/haptics.svelte';
	import { accentFor } from '$lib/accent';

	/**
	 * Everything about how the app looks and feels, in one place.
	 *
	 * These three had been sitting apart on the settings root: theme and haptics
	 * in one card, the accent in another two screens down, with the workspace's
	 * feature settings in between. They are one subject and they now read as one,
	 * which also gets the settings root back to a list of destinations.
	 *
	 * Two of the three are per-device (localStorage, no round trip) and one is
	 * per-workspace (a column, owner-only). The page says which is which rather
	 * than letting the reader guess from where a control happens to sit.
	 */
	let { data, form } = $props();
	let slug = $derived(page.params.workspace);

	// Seeded from the server and re-derived when the load data changes; Save
	// appears only once the picked value and the stored one diverge.
	const currentAccent = $derived(accentFor({ slug: slug ?? '', accentColor: data.accentColor }));
	let accent = $derived(currentAccent);

	const themeOptions: { id: ThemePref; label: string; icon: typeof Sun }[] = [
		{ id: 'system', label: 'System', icon: Monitor },
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon }
	];
</script>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[15px]"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>
	<h1 class="px-1 text-[28px]">Appearance</h1>

	{#if form?.error}
		<p class="card p-3 text-[14px]" style="color: var(--deny)">{form.error}</p>
	{/if}

	<section class="card p-5">
		<h2
			class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
			style="color: var(--ink)"
		>
			<Sun class="h-4 w-4" style="color: var(--ws-accent)" /> Theme
		</h2>
		<p class="mt-1 mb-3.5 text-[13px]" style="color: var(--ink-3)">
			Follows your device by default. Saved on this device.
		</p>
		<Segmented
			options={themeOptions.map((o) => ({ value: o.id, label: o.label, icon: o.icon }))}
			value={theme.pref}
			onselect={(v) => setTheme(v as ThemePref)}
			ariaLabel="Theme"
		/>
	</section>

	<!--
		A switch, like every other on/off in settings. It was a checkbox, which is
		the one control shape this app uses for "pick several of these" and never
		for a setting you flip. `onToggle` rather than `flag`: the preference lives
		in localStorage, because a phone vibrates and a laptop does not.
	-->
	<section class="card flex items-start justify-between gap-4 p-5">
		<div>
			<h2
				class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
				style="color: var(--ink)"
			>
				<Vibrate class="h-4 w-4" style="color: var(--ws-accent)" /> Haptics
			</h2>
			<p class="mt-1 text-[13px] leading-relaxed" style="color: var(--ink-3)">
				A tap when something saves, latches, or goes wrong. Needs a device that can buzz, and on
				iPhone an app installed to the home screen running iOS 17.4 or later. Saved on this device.
			</p>
		</div>
		<Toggle on={haptics.on} onToggle={(next) => setHaptics(next)} label="Toggle haptics" />
	</section>

	<!--
		A way to answer "is this even working?" without going and saving something.
		Worth having because the honest answer on a given device is often no, and
		hunting for a form to submit to find that out is a poor way to learn it.
	-->
	{#if haptics.on}
		<button
			onclick={() => haptic('success')}
			class="press card w-full p-4 text-center text-[15px] font-medium"
			style="color: var(--accent-ink)"
		>
			Feel a test tap
		</button>
	{/if}

	{#if data.isOwner}
		<section class="card p-5">
			<h2
				class="flex items-center gap-2 font-[family-name:var(--font-sans)] text-[16px] font-semibold tracking-normal"
				style="color: var(--ink)"
			>
				<Palette class="h-4 w-4" style="color: var(--ws-accent)" /> Accent
			</h2>
			<p class="mt-1 mb-3.5 text-[13px]" style="color: var(--ink-3)">
				Colors this workspace for everyone in it. Each workspace keeps its own.
			</p>
			<form method="POST" action="?/accent" use:submit={{ success: 'Accent updated' }}>
				<AccentPicker bind:value={accent} label="" />
				<input type="hidden" name="accentColor" value={accent} />
				{#if accent !== currentAccent}
					<button class="btn btn-tint mt-3.5 px-4 py-2 text-[14px]">Save accent</button>
				{/if}
			</form>
		</section>
	{/if}
</div>
