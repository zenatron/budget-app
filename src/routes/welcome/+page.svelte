<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
</script>

<svelte:head>
	<title>Welcome — Budget</title>
</svelte:head>

<main class="min-h-svh bg-neutral-50 px-6 py-12 dark:bg-neutral-950">
	<div class="mx-auto max-w-md space-y-8">
		<header>
			<h1 class="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
				Hi, {data.displayName}
			</h1>
			<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
				Create a workspace or join one with an invite code.
			</p>
		</header>

		{#if data.workspaces.length > 0}
			<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
				<h2 class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Your workspaces</h2>
				<ul class="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
					{#each data.workspaces as ws (ws.slug)}
						<li>
							<a
								href="/w/{ws.slug}"
								class="block py-2.5 font-medium text-neutral-900 hover:text-neutral-600 dark:text-neutral-50 dark:hover:text-neutral-300"
							>
								{ws.name}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="font-medium text-neutral-900 dark:text-neutral-50">Create a workspace</h2>
			<form method="POST" action="?/create" use:enhance class="mt-4 space-y-3">
				<label class="block">
					<span class="text-sm text-neutral-600 dark:text-neutral-400">Name</span>
					<input
						name="name"
						required
						maxlength="60"
						placeholder="Our household"
						class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
					/>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span class="text-sm text-neutral-600 dark:text-neutral-400">Currency</span>
						<select
							name="currency"
							class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						>
							{#each data.currencies as c (c)}
								<option value={c} selected={c === 'USD'}>{c}</option>
							{/each}
						</select>
					</label>
					<label class="block">
						<span class="text-sm text-neutral-600 dark:text-neutral-400">Timezone</span>
						<select
							name="timezone"
							class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						>
							{#each data.timezones as tz (tz)}
								<option value={tz} selected={tz === defaultTz}>{tz}</option>
							{/each}
						</select>
					</label>
				</div>
				{#if form?.action === 'create' && form?.error}
					<p class="text-sm text-red-600 dark:text-red-400">{form.error}</p>
				{/if}
				<button
					class="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
				>
					Create workspace
				</button>
			</form>
		</section>

		<section class="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
			<h2 class="font-medium text-neutral-900 dark:text-neutral-50">Join with an invite code</h2>
			<form method="POST" action="?/join" use:enhance class="mt-4 space-y-3">
				<input
					name="code"
					required
					placeholder="e.g. 7XK2M9QRTB"
					autocapitalize="characters"
					autocomplete="off"
					spellcheck="false"
					class="w-full rounded-lg border-neutral-200 bg-white font-mono text-sm tracking-widest uppercase dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				/>
				{#if form?.action === 'join' && form?.error}
					<p class="text-sm text-red-600 dark:text-red-400">{form.error}</p>
				{/if}
				<button
					class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-900 transition active:scale-[0.98] dark:border-neutral-700 dark:text-neutral-50"
				>
					Join workspace
				</button>
			</form>
		</section>

		<form method="POST" action="/auth/logout" class="text-center">
			<button class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
				Sign out
			</button>
		</form>
	</div>
</main>
