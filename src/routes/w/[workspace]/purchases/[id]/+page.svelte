<script lang="ts">
	import { enhance } from '$app/forms';
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { formatMinor } from '$lib/money-format';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import { money } from '$lib/actions/money';
	import ImageViewer from '$lib/components/ImageViewer.svelte';

	let { data, form } = $props();
	let viewing = $state(false);
	let slug = $derived(page.params.workspace);
	let editing = $state(false);
	let deciding = $state<'approve' | 'deny' | null>(null);
	let showDeny = $state(false);
	const p = $derived(data.purchase);

	function fmtDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function fmtDateLong(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
	}

	const displayAmount = $derived(p.finalAmountMinor ?? p.requestedAmountMinor);
	const isPending = $derived(p.state === 'pending_approval');
	const img = $derived(data.images[0]);

	const stateLabel: Record<string, string> = {
		draft: 'Draft',
		pending_approval: 'Waiting',
		approved: 'Approved',
		denied: 'Denied',
		cancelled: 'Cancelled',
		completed: 'Completed',
		refunded: 'Refunded'
	};
	const stateVar: Record<string, string> = {
		pending_approval: '--pending',
		approved: '--approve',
		denied: '--deny',
		refunded: '--info',
		completed: '--approve',
		draft: '--ink-3',
		cancelled: '--ink-3'
	};
</script>

<div class="mx-auto max-w-lg">
	<a
		href="/w/{slug}/purchases"
		class="press mb-4 -ml-1 inline-flex items-center gap-0.5 text-[14px] font-medium"
		style="color: var(--ink-3)"
	>
		<Icon name="chevronLeft" class="h-4 w-4" /> Ledger
	</a>

	<!-- Editorial masthead: the amount as a magazine headline -->
	<div style="view-transition-name: vt-card-{p.id}">
		<span
			class="chip"
			style="color: var({stateVar[p.state] ??
				'--ink-4'}); background: color-mix(in oklab, var({stateVar[p.state] ??
				'--ink-4'}) 14%, transparent)"
		>
			{stateLabel[p.state]}{p.stale ? ' — stale' : ''}{isPending && p.waitingDays > 0
				? ` · ${p.waitingDays}d`
				: ''}
		</span>
		<Money
			minor={displayAmount}
			currency={p.currency}
			block
			class="mt-3 font-[family-name:var(--font-display)] text-[length:var(--fs-mega)] leading-[0.92] font-semibold"
		/>
		<p class="mt-4 text-[18px] leading-tight font-medium" style="color: var(--ink-2)">
			{p.itemName}
		</p>
		<p class="mt-2 text-[14px]" style="color: var(--ink-3)">
			Requested by {p.requesterName}{p.completedAt ? ` · ${fmtDateLong(p.completedAt)}` : ''}
		</p>
	</div>

	{#if data.isRefund && !img}
		<!--
			A refund reverses a purchase, so it shows that purchase: the original's
			photo, dimmed under a reversal arrow. Tapping goes to the original. No
			photo controls — the image belongs to the parent, and is edited there.
		-->
		<a
			href="/w/{slug}/purchases/{data.parentId}"
			class="press relative mt-5 block overflow-hidden rounded-[14px]"
			style="box-shadow: var(--shadow-card), inset 0 0 0 1px var(--hairline)"
		>
			{#if data.inheritedImage}
				<!--
					Desaturated enough to read as past tense, light enough to still
					recognize the item — dimming it into a slab would defeat the point
					of showing the photo at all. Contrast for the label comes from a
					scrim behind it, not from crushing the image.
				-->
				<img
					src="/w/{slug}/blobs/{data.inheritedImage}"
					alt=""
					class="aspect-[4/3] w-full object-cover"
					style="filter: grayscale(0.45) brightness(0.92)"
					loading="eager"
				/>
				<span
					class="absolute inset-0"
					style="background: radial-gradient(60% 50% at 50% 50%, oklch(0 0 0 / 0.5), oklch(0 0 0 / 0.12))"
				></span>
			{:else}
				<div class="aspect-[4/3] w-full" style="background: var(--surface-2)"></div>
			{/if}
			<span class="absolute inset-0 flex flex-col items-center justify-center gap-2">
				<span
					class="flex h-14 w-14 items-center justify-center rounded-full backdrop-blur"
					style="background: {data.inheritedImage
						? 'oklch(0 0 0 / 0.45)'
						: 'var(--surface)'}; color: {data.inheritedImage ? 'white' : 'var(--ink-3)'}"
				>
					<Icon name="reverse" class="h-6 w-6" />
				</span>
				<!--
					Says what tapping does. "Reverses this purchase" read as though the
					thing on screen were being reversed — the arrow already carries the
					"this is a refund" meaning, so the label is free to be the action.
				-->
				<span
					class="text-[13px] font-semibold"
					style="color: {data.inheritedImage ? 'white' : 'var(--ink-3)'}"
				>
					See original purchase
				</span>
			</span>
		</a>
	{:else if img}
		<div class="relative mt-5">
			<!--
				The image sets its own shape. A fixed aspect box with object-cover threw
				away more than half of any portrait photo — which is most phone photos.
				Its real job was holding space so the page doesn't jump while the image
				loads, and the stored width/height do that exactly, without a crop.
				Capped so a tall receipt doesn't push everything else off screen; the
				viewer is where it gets the whole screen.
			-->
			<button
				onclick={() => (viewing = true)}
				class="press block w-full overflow-hidden rounded-[14px]"
				style="box-shadow: var(--shadow-card), inset 0 0 0 1px var(--hairline); background: var(--surface-2)"
				aria-label="View photo full screen"
			>
				<img
					src="/w/{slug}/blobs/{img.blobId}"
					alt={p.itemName}
					width={img.width}
					height={img.height}
					class="max-h-[70vh] w-full object-contain"
					style="aspect-ratio: {img.width} / {img.height}"
					loading="eager"
				/>
			</button>
			<ImageViewer src="/w/{slug}/blobs/{img.blobId}" alt={p.itemName} bind:open={viewing} />
			<!--
				Photo controls sit on the photo, because they act on it. A purchase
				carries exactly one, so this replaces rather than appends — the old
				"Add another photo" stored images that nothing ever displayed.
			-->
			{#if data.can.addPhoto}
				<div class="absolute right-2.5 bottom-2.5 flex gap-2">
					<form method="POST" action="?/addImage" enctype="multipart/form-data">
						<label
							class="press flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold backdrop-blur"
							style="background: oklch(0 0 0 / 0.55); color: white"
						>
							<Icon name="camera" class="h-3.5 w-3.5" /> Replace
							<input
								type="file"
								name="photo"
								accept="image/jpeg,image/png,image/webp"
								required
								class="sr-only"
								onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
							/>
						</label>
					</form>
					<form
						method="POST"
						action="?/removeImage"
						use:submit={{ confirm: 'Remove this photo?', success: 'Photo removed' }}
					>
						<button
							class="press flex items-center justify-center rounded-full px-2.5 py-1.5 backdrop-blur"
							style="background: oklch(0 0 0 / 0.55); color: white"
							aria-label="Remove photo"
						>
							<Icon name="trash" class="h-3.5 w-3.5" />
						</button>
					</form>
				</div>
			{/if}
		</div>
	{/if}

	{#if data.can.addPhoto && data.images.length === 0}
		<form method="POST" action="?/addImage" enctype="multipart/form-data" class="mt-5">
			<label
				class="press flex cursor-pointer items-center gap-3 rounded-[14px] px-4 py-4"
				style="box-shadow: inset 0 0 0 1px var(--hairline); background: var(--surface)"
			>
				<Icon name="camera" class="h-5 w-5" style="color: var(--ink-3)" />
				<span class="text-[15px]" style="color: var(--ink-3)"
					>{data.isRefund
						? 'Add a photo of the return receipt'
						: 'Add a photo of what you bought'}</span
				>
				<input
					type="file"
					name="photo"
					accept="image/jpeg,image/png,image/webp"
					required
					class="sr-only"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
				/>
			</label>
		</form>
	{/if}

	<div class="mt-6 space-y-4">
		{#if p.isOverageReapproval && p.approvedAmountMinor !== null}
			<div
				class="rounded-[12px] p-4"
				style="background: color-mix(in oklab, var(--pending) 14%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pending) 26%, transparent)"
			>
				<p
					class="flex items-center gap-1.5 text-[14px] font-semibold"
					style="color: var(--pending)"
				>
					<Icon name="exclamation" class="h-4 w-4" /> Over budget — needs re-approval
				</p>
				<p class="num mt-1 text-[13px]" style="color: var(--ink-2)">
					Approved {formatMinor(p.approvedAmountMinor, p.currency)}, spent {formatMinor(
						p.finalAmountMinor!,
						p.currency
					)}
				</p>
			</div>
		{/if}

		{#if form?.error}
			<div
				class="rounded-[12px] p-4 text-[15px]"
				style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--deny) 26%, transparent)"
			>
				{form.error}
			</div>
		{/if}

		<!-- The centerpiece: decide. -->
		{#if data.can.decide}
			<div class="space-y-2.5">
				<form
					method="POST"
					action="?/approve"
					use:enhance={() => {
						deciding = 'approve';
						return async ({ update }) => {
							await update();
							deciding = null;
						};
					}}
				>
					<button class="btn btn-accent w-full py-4 text-[18px]" disabled={deciding !== null}>
						{#if deciding === 'approve'}
							<span class="spin h-5 w-5"></span>
						{:else}
							<Icon name="checkmark" class="h-5 w-5" /> Approve {formatMinor(
								displayAmount,
								p.currency
							)}
						{/if}
					</button>
				</form>

				{#if showDeny}
					<form
						method="POST"
						action="?/deny"
						use:enhance={() => {
							deciding = 'deny';
							return async ({ update }) => {
								await update();
								deciding = null;
							};
						}}
						class="space-y-2.5"
					>
						<input name="reason" placeholder="Reason (optional)" class="field text-[16px]" />
						<button
							class="btn w-full py-3.5 text-[16px]"
							style="color: var(--deny); background: color-mix(in oklab, var(--deny) 12%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--deny) 30%, transparent)"
							disabled={deciding !== null}
						>
							{#if deciding === 'deny'}<span class="spin h-4 w-4"></span>{:else}Deny request{/if}
						</button>
					</form>
				{:else}
					<button
						onclick={() => (showDeny = true)}
						class="btn btn-plain w-full"
						style="color: var(--deny)">Deny…</button
					>
				{/if}
			</div>
		{/if}

		<!-- Details as a printed ledger -->
		<div>
			<p class="section-label mb-1">Details</p>
			<div class="rule">
				<div class="hairline flex items-center justify-between py-3.5">
					<span class="text-[15px]" style="color: var(--ink-3)">Requested by</span>
					<span class="text-[15px] font-medium" style="color: var(--ink)">{p.requesterName}</span>
				</div>
				{#if p.merchantName}
					<div class="hairline flex items-center justify-between py-3.5">
						<span class="text-[15px]" style="color: var(--ink-3)">Where</span>
						<span class="text-[15px] font-medium" style="color: var(--ink)">{p.merchantName}</span>
					</div>
				{/if}
				{#if isPending}
					<div class="hairline flex items-center justify-between py-3.5">
						<span class="text-[15px]" style="color: var(--ink-3)">Waiting on</span>
						<span class="text-[15px] font-medium" style="color: var(--ink)"
							>{p.approverNames.join(' or ')}</span
						>
					</div>
				{/if}
				{#if p.approvedAmountMinor !== null && !p.isOverageReapproval}
					<div class="hairline flex items-center justify-between py-3.5">
						<span class="text-[15px]" style="color: var(--ink-3)">Approved</span>
						<span class="num text-[15px] font-semibold" style="color: var(--approve)"
							>{formatMinor(p.approvedAmountMinor, p.currency)}</span
						>
					</div>
				{/if}
				{#if p.completedAt}
					<div class="hairline flex items-center justify-between py-3.5">
						<span class="text-[15px]" style="color: var(--ink-3)">Date</span>
						<span class="text-[15px] font-medium" style="color: var(--ink)"
							>{fmtDateLong(p.completedAt)}</span
						>
					</div>
				{/if}
				{#if p.note}
					<p class="hairline py-3.5 text-[15px] leading-relaxed" style="color: var(--ink-2)">
						{p.note}
					</p>
				{/if}
			</div>
		</div>

		{#if p.sealed}
			<div
				class="rounded-[14px] p-4"
				style="background: color-mix(in oklab, var(--seal) 10%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--seal) 30%, transparent)"
			>
				<div class="flex items-start gap-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
						style="background: color-mix(in oklab, var(--seal) 18%, transparent)"
					>
						<Icon name="lock" class="h-4 w-4" style="color: var(--seal)" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-[15px] font-semibold" style="color: var(--seal)">
							Hidden from {p.sealedFromNames.join(' and ')}
						</p>
						<p class="mt-0.5 text-[13px]" style="color: var(--ink-3)">
							Until {fmtDate(p.sealedUntil!)} — invisible everywhere, including totals.
						</p>
						{#if data.can.unseal}
							<form
								method="POST"
								action="?/unseal"
								use:submit={{
									confirm: 'Reveal this purchase now? It becomes visible to everyone immediately.',
									success: 'Purchase revealed'
								}}
								class="mt-2.5"
							>
								<button
									class="btn py-2 text-[13px]"
									style="color: var(--seal); background: color-mix(in oklab, var(--seal) 14%, transparent)"
									>Reveal now</button
								>
							</form>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		{#if data.can.complete}
			<div class="card p-5">
				<p class="text-[15px] font-semibold" style="color: var(--ink)">Mark as bought</p>
				<p class="mt-0.5 text-[13px]" style="color: var(--ink-3)">
					Enter what you actually spent — a large overage triggers re-approval.
				</p>
				<form
					method="POST"
					action="?/complete"
					use:submit={{ success: 'Marked as bought' }}
					class="mt-3.5 space-y-3"
				>
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="section-label mb-1.5 block">Actually spent</span>
							<input
								name="finalAmount"
								aria-label="Final amount"
								use:money
								required
								inputmode="decimal"
								placeholder="Final amount"
								value={formatMinor(
									p.approvedAmountMinor ?? p.requestedAmountMinor,
									p.currency
								).replace(/[^0-9.]/g, '')}
								class="field num text-[17px]"
							/>
						</label>
						<label class="block">
							<span class="section-label mb-1.5 block">On</span>
							<input name="finalDate" type="date" aria-label="Date" class="field text-[16px]" />
						</label>
					</div>
					<button class="btn btn-accent w-full">Complete purchase</button>
				</form>
			</div>
		{/if}

		{#if data.can.edit}
			<div class="card p-5">
				<button
					onclick={() => (editing = !editing)}
					class="press flex w-full items-center justify-between text-[15px]"
					style="color: var(--ink)"
				>
					<span class="font-medium">Edit details</span>
					<Icon
						name="chevronDown"
						class="h-4 w-4 transition-transform duration-200 {editing ? 'rotate-180' : ''}"
						style="color: var(--ink-4)"
					/>
				</button>
				{#if editing}
					{#if p.state === 'approved' && p.approverNames.length > 0}
						<p class="mt-3 text-[13px]" style="color: var(--pending)">
							Changing item, amount, or category sends this back to {p.approverNames.join(' or ')}
							for approval.
						</p>
					{:else if p.state === 'approved'}
						<p class="mt-3 text-[13px]" style="color: var(--ink-3)">
							This didn't need approval, so changes apply straight away.
						</p>
					{/if}
					<form
						method="POST"
						action="?/edit"
						use:submit={{ success: 'Changes saved' }}
						class="mt-3 space-y-3"
					>
						<label class="block">
							<span class="section-label mb-1.5 block">Item</span>
							<input
								name="itemName"
								aria-label="Item"
								required
								value={p.itemName}
								class="field text-[16px]"
							/>
						</label>
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="section-label mb-1.5 block">Asking for</span>
								<input
									name="amount"
									aria-label="Amount requested"
									use:money
									required
									inputmode="decimal"
									value={formatMinor(p.requestedAmountMinor, p.currency).replace(/[^0-9.]/g, '')}
									class="field num text-[16px]"
								/>
							</label>
							<label class="block">
								<span class="section-label mb-1.5 block">Category</span>
								<select name="categoryId" aria-label="Category" class="field text-[16px]">
									<option value="">None</option>
									{#each data.categories as c (c.id)}
										<option value={c.id} selected={c.id === p.categoryId}>{c.icon} {c.name}</option>
									{/each}
								</select>
							</label>
						</div>
						<label class="block">
							<span class="section-label mb-1.5 block">Note</span>
							<textarea name="note" aria-label="Note" rows="2" class="field text-[16px]"
								>{p.note ?? ''}</textarea
							>
						</label>
						<button class="btn btn-ghost w-full">Save changes</button>
					</form>
				{/if}
			</div>
		{/if}

		{#if data.can.refund}
			<div class="card p-5">
				<p class="text-[15px] font-semibold" style="color: var(--ink)">Record a refund</p>
				<form
					method="POST"
					action="?/refund"
					use:submit={{ success: 'Refund recorded' }}
					class="mt-3 flex gap-2.5"
				>
					<input
						name="refundAmount"
						use:money
						required
						inputmode="decimal"
						placeholder="Amount"
						class="field num flex-1 text-[16px]"
					/>
					<button class="btn btn-ghost shrink-0">Record</button>
				</form>
			</div>
		{/if}

		{#if data.can.cancel}
			<form
				method="POST"
				action="?/cancel"
				use:submit={{ confirm: 'Cancel this purchase?', success: 'Purchase cancelled' }}
				class="pt-1 text-center"
			>
				<button class="btn btn-plain" style="color: var(--ink-4)">Cancel this purchase</button>
			</form>
		{/if}

		{#if data.events.length > 0}
			<div>
				<p class="section-label mb-3">History</p>
				<div class="space-y-4">
					{#each data.events as e, i (e.at + i)}
						<div class="flex items-baseline gap-3">
							<span
								class="mt-1 h-2 w-2 shrink-0 rounded-full"
								style="background: var({stateVar[e.toState] ?? '--ink-4'})"
							></span>
							<div class="flex min-w-0 flex-1 items-baseline justify-between gap-3">
								<span class="text-[13px]" style="color: var(--ink-2)">
									{stateLabel[e.toState] ?? e.toState}{e.actorName
										? ` · ${e.actorName}`
										: ''}{e.reason ? ` — ${e.reason}` : ''}
								</span>
								<span class="num shrink-0 text-[12px]" style="color: var(--ink-4)">
									{fmtDate(e.at)}{e.amountMinor !== null
										? ` · ${formatMinor(e.amountMinor, p.currency)}`
										: ''}
								</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.spin {
		border-radius: 999px;
		border: 2.5px solid color-mix(in oklab, var(--paper) 40%, transparent);
		border-top-color: var(--paper);
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
