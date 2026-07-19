<script lang="ts">
	let {
		name,
		class: cls = '',
		style = ''
	}: { name: string; class?: string; style?: string } = $props();
</script>

<span class="contents" {style}>
	{#if name === 'card'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 10h20" /></svg
		>
	{:else if name === 'chart'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><rect x="3" y="13" width="4" height="8" rx="1" /><rect
				x="10"
				y="8"
				width="4"
				height="13"
				rx="1"
			/><rect x="17" y="3" width="4" height="18" rx="1" /></svg
		>
	{:else if name === 'question'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><circle cx="12" cy="12" r="9" /><path
				d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4"
			/><path d="M12 17.6h.01" /></svg
		>
	{:else if name === 'reverse'}
		<!-- Counterclockwise arrow: money going back the way it came. -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M3 5v6h6" /><path d="M3.5 11a9 9 0 1 1 1.4 6.4" /></svg
		>
	{:else if name === 'repeat'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path
				d="M21 13v2a4 4 0 01-4 4H3"
			/></svg
		>
	{:else if name === 'dollar'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><circle cx="12" cy="12" r="9" /><path d="M12 7v2.5M12 14.5V17" /><path
				d="M14.5 9.5h-4a1.5 1.5 0 100 3h3a1.5 1.5 0 010 3h-4"
			/></svg
		>
	{:else if name === 'gear'}
		<!--
			An actual cog. The previous path was a circle with eight radiating
			spokes — which is a sun, not a gear, and read as one at 20px.
		-->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path
				d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
			/><circle cx="12" cy="12" r="3" /></svg
		>
	{:else if name === 'plus'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			class={cls}><path d="M12 5v14M5 12h14" /></svg
		>
	{:else if name === 'chevronLeft'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M15 18l-6-6 6-6" /></svg
		>
	{:else if name === 'chevronDown'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M6 9l6 6 6-6" /></svg
		>
	{:else if name === 'lock'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><rect x="4" y="11" width="16" height="11" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /><circle
				cx="12"
				cy="16"
				r="1"
			/></svg
		>
	{:else if name === 'checkmark'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M5 13l4 4L19 7" /></svg
		>
	{:else if name === 'xmark'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M18 6L6 18M6 6l12 12" /></svg
		>
	{:else if name === 'clock'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg
		>
	{:else if name === 'bag'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M4 7h16v14a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" /><path d="M8 7V5a4 4 0 018 0v2" /></svg
		>
	{:else if name === 'camera'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path
				d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
			/><circle cx="12" cy="13" r="4" /></svg
		>
	{:else if name === 'exclamation'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg
		>
	{:else if name === 'search'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg
		>
	{:else if name === 'gift'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><rect x="3" y="8" width="18" height="13" rx="2" /><path
				d="M12 8V21M17 4a3 3 0 00-3 3v1h3a3 3 0 000-6zM7 4a3 3 0 013 3v1H7a3 3 0 010-6z"
			/></svg
		>
	{:else if name === 'people'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M16 20v-1.5a4 4 0 00-4-4H6a4 4 0 00-4 4V20" /><circle cx="9" cy="7" r="3.5" /><path
				d="M22 20v-1.5a4 4 0 00-3-3.87"
			/><path d="M16.5 3.75a4 4 0 010 6.5" /></svg
		>
	{:else if name === 'bell'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path
				d="M13.73 21a2 2 0 01-3.46 0"
			/></svg
		>
	{:else if name === 'trash'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path
				d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"
			/></svg
		>
	{:else if name === 'pause'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class={cls}
			><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect
				x="14"
				y="5"
				width="4"
				height="14"
				rx="1.5"
			/></svg
		>
	{:else if name === 'play'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class={cls}
			><path d="M7 5.5v13a1 1 0 001.5.87l11-6.5a1 1 0 000-1.74l-11-6.5A1 1 0 007 5.5z" /></svg
		>
	{:else if name === 'calendar'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg
		>
	{:else if name === 'arrowUpRight'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M7 17L17 7M8 7h9v9" /></svg
		>
	{:else if name === 'chevronRight'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M9 6l6 6-6 6" /></svg
		>
	{:else if name === 'wallet'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M3 7a2 2 0 012-2h13a1 1 0 011 1v2" /><path
				d="M3 7v10a2 2 0 002 2h14a1 1 0 001-1v-3"
			/><path d="M21 10v4h-4a2 2 0 010-4h4z" /></svg
		>
	{:else if name === 'pin'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2C20 17.5 12 22 12 22z" /><circle
				cx="12"
				cy="10"
				r="3"
			/></svg
		>
	{:else if name === 'bank'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M12 2l8 4.5v2H4v-2L12 2z" /><path d="M4 9v8h16V9" /><path
				d="M8 9v6M12 9v6M16 9v6"
			/></svg
		>
	{:else if name === 'sparkle'}
		<!--
			Three four-point stars with concave sides (quadratic curves pulled to the
			center), the way the ✨ glyph reads — a single convex star looked like a
			rating widget, not an "ask me something" affordance. Filled, not stroked,
			so it stays legible at 16px.
		-->
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class={cls}>
			<path
				d="M9.5 2.2C10.1 6.4 11.1 7.4 15.3 8 11.1 8.6 10.1 9.6 9.5 13.8 8.9 9.6 7.9 8.6 3.7 8 7.9 7.4 8.9 6.4 9.5 2.2Z"
			/>
			<path
				d="M17.5 12.4C17.8 15 18.3 15.5 20.9 15.8 18.3 16.1 17.8 16.6 17.5 19.2 17.2 16.6 16.7 16.1 14.1 15.8 16.7 15.5 17.2 15 17.5 12.4Z"
			/>
			<path
				d="M7.2 16.6C7.4 18.4 7.7 18.7 9.5 18.9 7.7 19.1 7.4 19.4 7.2 21.2 7 19.4 6.7 19.1 4.9 18.9 6.7 18.7 7 18.4 7.2 16.6Z"
			/>
		</svg>
	{:else if name === 'funnel'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M4 4h16l-5.33 7.11a2 2 0 00-.33 1.07v3.82l-4 2V12.18a2 2 0 00-.34-1.07L4 4z" /></svg
		>
	{:else if name === 'pencil'}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="M15 5l4 4" /></svg
		>
	{:else}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><circle cx="12" cy="12" r="10" /></svg
		>
	{/if}
</span>
