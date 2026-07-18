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
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}
			><circle cx="12" cy="12" r="3" /><path
				d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
			/></svg
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
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" /></svg
		>
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
