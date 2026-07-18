<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<div class="mx-auto max-w-md">
	<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">New purchase</h1>

	<form
		method="POST"
		use:enhance
		class="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900"
	>
		<label class="block">
			<span class="text-sm text-neutral-600 dark:text-neutral-400">Item</span>
			<input
				name="itemName"
				required
				maxlength="120"
				placeholder="Noise-cancelling headphones"
				class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
			/>
		</label>

		<label class="block">
			<span class="text-sm text-neutral-600 dark:text-neutral-400">
				Amount ({data.workspace.currency})
			</span>
			<input
				name="amount"
				required
				inputmode="decimal"
				placeholder="180.00"
				class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
			/>
		</label>

		<label class="block">
			<span class="text-sm text-neutral-600 dark:text-neutral-400">Category</span>
			<select
				name="categoryId"
				class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
			>
				<option value="">None</option>
				{#each data.categories as c (c.id)}
					<option value={c.id}>{c.icon} {c.name}</option>
				{/each}
			</select>
		</label>

		<label class="block">
			<span class="text-sm text-neutral-600 dark:text-neutral-400">Note (optional)</span>
			<textarea
				name="note"
				rows="2"
				maxlength="2000"
				class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
			></textarea>
		</label>

		{#if data.sealableMembers.length > 0}
			<details class="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/60">
				<summary class="cursor-pointer text-sm font-medium text-neutral-600 dark:text-neutral-400">
					🔒 Gift mode — hide this purchase
				</summary>
				<div class="mt-3 space-y-3">
					<p class="text-xs text-neutral-500 dark:text-neutral-400">
						Hidden members won't see this purchase anywhere — including totals — until the seal
						opens. Their view of workspace spending will be temporarily understated.
					</p>
					<fieldset>
						<legend class="text-xs text-neutral-500 dark:text-neutral-400">Hide from</legend>
						<div class="mt-1 flex flex-wrap gap-3">
							{#each data.sealableMembers as m (m.id)}
								<label
									class="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300"
								>
									<input
										type="checkbox"
										name="sealMemberIds"
										value={m.id}
										class="rounded border-neutral-300 dark:border-neutral-600"
									/>
									{m.displayName}
								</label>
							{/each}
						</div>
					</fieldset>
					<label class="block">
						<span class="text-xs text-neutral-500 dark:text-neutral-400">
							Reveal on (max {data.maxSealDays} days)
						</span>
						<input
							type="date"
							name="sealUntil"
							class="mt-1 w-full rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
						/>
					</label>
				</div>
			</details>
		{/if}

		{#if form?.error}
			<p class="text-sm text-red-600 dark:text-red-400">{form.error}</p>
		{/if}

		<div class="grid grid-cols-2 gap-3">
			<button
				name="intent"
				value="log"
				class="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
			>
				Log it — already bought
			</button>
			<button
				name="intent"
				value="request"
				class="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-900 transition active:scale-[0.98] dark:border-neutral-700 dark:text-neutral-50"
			>
				Ask first
			</button>
		</div>
	</form>
</div>
