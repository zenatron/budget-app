<script lang="ts">
	import { submit } from '$lib/actions/submit';
	import { page } from '$app/state';
	import { ChevronLeft } from '@lucide/svelte';
	import { money } from '$lib/actions/money';
	import { formatMinor } from '$lib/money-format';

	let { data, form } = $props();
	let slug = $derived(page.params.workspace);
	let editingPolicy: string | null = $state(null);
	let copied: string | null = $state(null);

	const roleLabel: Record<string, string> = { owner: 'Owner', member: 'Member' };

	/*
	 * Draft state for the open editor. The policy form's fields depend on each
	 * other — a threshold only means something in "Above amount", approvers only
	 * when approval can be required — so the selects have to be bound rather than
	 * uncontrolled, or the form can't hide what doesn't apply.
	 */
	let mode = $state('none');
	let routingMode = $state('any_of');
	let approvers = $state<string[]>([]);
	let bucketCharges = $state('inherit');
	let threshold = $state('');

	const activeMembers = $derived(data.members.filter((m) => m.status === 'active'));
	/** Approvers only matter when something can actually need approving. */
	const canRequireApproval = $derived(mode !== 'none' || bucketCharges === 'require');

	function openPolicy(m: (typeof data.members)[number]) {
		if (editingPolicy === m.id) {
			editingPolicy = null;
			return;
		}
		editingPolicy = m.id;
		mode = m.policy.mode;
		routingMode = m.policy.routing.mode;
		approvers = [...m.policy.routing.approver_ids];
		bucketCharges = m.policy.bucket_charges ?? 'inherit';
		threshold =
			m.policy.threshold_minor !== undefined ? (m.policy.threshold_minor / 100).toFixed(2) : '';
	}

	const nameOf = (id: string) => data.members.find((m) => m.id === id)?.displayName ?? 'someone';

	/**
	 * The policy read back in a sentence, live, as you edit it.
	 *
	 * The controls describe the rule in pieces — a mode, a number, a routing
	 * choice, a list — and it is genuinely hard to tell from four widgets what
	 * combination you have just built. This is the one place that says it whole,
	 * which is also how you notice you meant the opposite.
	 */
	const preview = $derived.by(() => {
		const who = editingPolicy ? nameOf(editingPolicy) : 'They';
		const lines: string[] = [];

		if (mode === 'none') lines.push(`${who} can spend freely.`);
		else if (mode === 'always') lines.push(`Everything ${who} buys needs approval.`);
		else {
			const amt = threshold.trim();
			lines.push(
				amt
					? `${who} needs approval at ${symbol}${amt} and above.`
					: `${who} needs approval above an amount — set it below.`
			);
		}

		if (bucketCharges === 'skip') {
			lines.push('Bucket charges never need approval.');
		} else if (bucketCharges === 'require') {
			lines.push('Bucket charges always need approval, even so.');
		} else if (data.workspaceSkipsBucketCharges) {
			lines.push('Bucket charges skip approval, following the workspace setting.');
		}

		if (canRequireApproval) {
			if (approvers.length === 0) lines.push('Nobody can decide yet.');
			else if (routingMode === 'specific') lines.push(`Only ${nameOf(approvers[0])} can decide.`);
			else if (approvers.length === 1) lines.push(`${nameOf(approvers[0])} decides.`);
			else
				lines.push(
					`Any of ${approvers.slice(0, -1).map(nameOf).join(', ')} or ${nameOf(approvers.at(-1)!)} can decide.`
				);
		}
		return lines.join(' ');
	});

	const symbol = $derived(
		(0)
			.toLocaleString(undefined, { style: 'currency', currency: data.workspace.currency })
			.replace(/[\d.,\s]/g, '')
	);

	/*
	 * "One specific approver" is validated server-side as exactly one
	 * (domain/approval/policy.ts). Checkboxes let you tick three and only find
	 * out on save, so that mode swaps to radios and this keeps the selection
	 * legal as you switch between them.
	 */
	function toggleApprover(id: string) {
		if (routingMode === 'specific') {
			approvers = [id];
			return;
		}
		approvers = approvers.includes(id) ? approvers.filter((x) => x !== id) : [...approvers, id];
	}

	function onRoutingChange(next: string) {
		routingMode = next;
		if (next === 'specific' && approvers.length > 1) approvers = [approvers[0]];
	}

	function policySummary(p: { mode: string; threshold_minor?: number | null }) {
		if (p.mode === 'none') return 'No approval needed';
		if (p.mode === 'always') return 'Always needs approval';
		const minor = p.threshold_minor ?? 0;
		return `Approval above ${formatMinor(BigInt(minor), data.workspace.currency)}`;
	}

	/**
	 * What happens to this member's bucket-charged purchases specifically.
	 *
	 * States the effective outcome rather than the stored setting: "inherit" is
	 * true of the configuration, but what you want to know reading down a list is
	 * whether these get approved, and inherit alone doesn't answer that without
	 * you also remembering the workspace default.
	 */
	function bucketSummary(p: { bucket_charges?: string }) {
		const rule = p.bucket_charges ?? 'inherit';
		if (rule === 'require') return 'Buckets always need approval';
		if (rule === 'skip') return 'Buckets skip approval';
		return data.workspaceSkipsBucketCharges
			? 'Buckets skip approval, per the workspace'
			: 'Buckets follow the same rule';
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copied = code;
			setTimeout(() => (copied = copied === code ? null : copied), 1400);
		} catch {
			/* clipboard may be unavailable */
		}
	}

	function expiresIn(iso: string) {
		const ms = new Date(iso).getTime() - Date.now();
		const days = Math.ceil(ms / 86_400_000);
		if (days <= 0) return 'Expired';
		return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
	}
</script>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[15px]"
		style="color: var(--ink-3)"
	>
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>
	<h1 class="px-1 text-[28px]">Members</h1>

	{#if form?.error}
		<p class="card p-3 text-[14px]" style="color: var(--deny)">{form.error}</p>
	{/if}

	<div class="card p-5">
		<p class="section-label">People</p>
		<div class="mt-1">
			{#each data.members as m (m.id)}
				<!-- One wrapper per member: the row and its policy editor belong
				     together, and without it nothing scopes to a single member. -->
				{@const disabled = m.status === 'disabled'}
				<div data-member={m.displayName}>
					<div class="hairline flex items-center justify-between gap-3 py-3 last:shadow-none">
						<div class="min-w-0" style={disabled ? 'opacity: 0.55' : ''}>
							<!-- A div, not a p: the role control is a form, which the browser
							     would hoist out of a paragraph and break hydration. -->
							<div
								class="flex flex-wrap items-center gap-x-2 text-[16px]"
								style="color: var(--ink)"
							>
								{m.displayName}
								<!--
									The role label is the control. The row already carries Policy and
									Disable, and a third text button crowds it on a phone — but the
									role is displayed here anyway, so making it the affordance costs
									no width and puts the action where the fact already is.
								-->
								{#if data.isOwner && !disabled}
									<form
										method="POST"
										action="?/setMemberRole"
										use:submit={{
											success: m.role === 'owner' ? 'Now a member' : 'Now an owner',
											// Stepping yourself down is the one move you cannot undo
											// alone — after it you are no longer an owner.
											confirm:
												m.id === data.viewerMemberId && m.role === 'owner'
													? 'Give up owner access? Another owner would have to give it back.'
													: undefined
										}}
									>
										<input type="hidden" name="memberId" value={m.id} />
										<button
											name="owner"
											value={m.role === 'owner' ? 'false' : 'true'}
											class="press rounded-[var(--r-full)] px-2 py-0.5 text-[12px] font-medium"
											style="background: {m.role === 'owner'
												? 'color-mix(in oklab, var(--ws-accent) 14%, transparent)'
												: 'var(--surface-2)'}; color: {m.role === 'owner'
												? 'var(--ws-accent)'
												: 'var(--ink-3)'}"
											title={m.role === 'owner' ? 'Step down to member' : 'Make an owner'}
										>
											{roleLabel[m.role]}
										</button>
									</form>
								{:else}
									<span class="text-[13px]" style="color: var(--ink-3)">{roleLabel[m.role]}</span>
								{/if}
								{#if m.status !== 'active'}
									<span class="text-[13px]" style="color: var(--ink-3)">· {m.status}</span>
								{/if}
							</div>
							{#if disabled}
								<!-- A disabled member has no access, so their approval rules say
								     nothing about what can happen. Showing them would read as if
								     they were still in force. -->
								<p class="text-[13px]" style="color: var(--ink-3)">No access to this workspace</p>
							{:else}
								<p class="text-[13px]" style="color: var(--ink-3)">{policySummary(m.policy)}</p>
								<!-- Dimmer than the line above: bucket charges are the exception
								     to the rule, so they read as a footnote to it rather than as a
								     second, competing headline. -->
								<p
									class="text-[12px]"
									style="color: color-mix(in oklab, var(--ink-3) 78%, transparent)"
								>
									{bucketSummary(m.policy)}
								</p>
							{/if}
						</div>
						{#if data.isOwner}
							<div class="flex shrink-0 items-center gap-3">
								{#if !disabled}
									<button
										onclick={() => openPolicy(m)}
										class="press text-[13px] font-medium"
										style="color: var(--ws-accent)"
										>{editingPolicy === m.id ? 'Done' : 'Policy'}</button
									>
								{/if}
								<!-- Not offered for yourself: the server refuses it, and an
								     action that can only fail shouldn't be on screen. -->
								{#if m.id !== data.viewerMemberId}
									<form
										method="POST"
										action="?/setMemberStatus"
										use:submit={{ success: disabled ? 'Member restored' : 'Member disabled' }}
									>
										<input type="hidden" name="memberId" value={m.id} />
										<button
											name="disabled"
											value={disabled ? 'false' : 'true'}
											class="press text-[13px] font-medium"
											style="color: {disabled ? 'var(--approve)' : 'var(--ink-3)'}"
											>{disabled ? 'Restore' : 'Disable'}</button
										>
									</form>
								{/if}
							</div>
						{/if}
					</div>

					{#if editingPolicy === m.id}
						<form
							method="POST"
							action="?/policy"
							use:submit={{ success: 'Policy updated' }}
							class="mt-1 mb-2 space-y-3 rounded-[14px] p-4"
							style="background: var(--surface-2)"
						>
							<input type="hidden" name="memberId" value={m.id} />

							<!-- The rule in a sentence, updating as you edit. -->
							<p
								class="rounded-[10px] px-3 py-2.5 text-[13px] leading-relaxed"
								style="background: var(--surface); color: var(--ink-2)"
							>
								{preview}
							</p>

							<label class="block">
								<span class="section-label mb-1.5 block">When {m.displayName} spends</span>
								<!-- Short options: the section label already says "when X spends",
								     and the longer phrasing overflowed the select on a phone. -->
								<select name="mode" bind:value={mode} class="field text-[16px]">
									<option value="none">Never needs approval</option>
									<option value="threshold">Needs approval above…</option>
									<option value="always">Always needs approval</option>
								</select>
							</label>

							<!--
								Only rendered for the mode that reads it: the server ignores the
								threshold unless mode is 'threshold', so leaving it on screen for
								"Never" showed an editable field that quietly did nothing.
							-->
							{#if mode === 'threshold'}
								<label class="block">
									<span class="section-label mb-1.5 block">Above</span>
									<input
										name="threshold"
										aria-label="Threshold"
										bind:value={threshold}
										use:money
										inputmode="decimal"
										placeholder="50.00"
										class="field text-[16px] tabular-nums"
									/>
								</label>
							{/if}

							<label class="block">
								<span class="section-label mb-1.5 block">Bucket charges</span>
								<select name="bucketCharges" bind:value={bucketCharges} class="field text-[16px]">
									<option value="inherit"
										>Follow the workspace ({data.workspaceSkipsBucketCharges
											? 'skip approval'
											: 'needs approval'})</option
									>
									<option value="skip">Never need approval</option>
									<option value="require">Always need approval</option>
								</select>
							</label>

							{#if canRequireApproval}
								<label class="block">
									<span class="section-label mb-1.5 block">Who decides</span>
									<select
										name="routingMode"
										value={routingMode}
										onchange={(e) => onRoutingChange(e.currentTarget.value)}
										class="field text-[16px]"
									>
										<option value="any_of">Any of these people</option>
										<option value="specific">One specific person</option>
									</select>
								</label>

								<div class="flex flex-wrap gap-x-4 gap-y-2">
									{#each activeMembers as a (a.id)}
										<label class="flex items-center gap-1.5 text-[15px]" style="color: var(--ink)">
											<input
												type={routingMode === 'specific' ? 'radio' : 'checkbox'}
												name="approverIds"
												value={a.id}
												checked={approvers.includes(a.id)}
												onchange={() => toggleApprover(a.id)}
											/>
											{a.displayName}
										</label>
									{/each}
								</div>
								{#if approvers.length === 0}
									<p class="text-[13px]" style="color: var(--pending)">
										Pick at least one person who can decide.
									</p>
								{/if}
							{:else}
								<!-- Kept in the form so clearing approval doesn't silently discard
								     who used to be named on it. -->
								{#each approvers as id (id)}
									<input type="hidden" name="approverIds" value={id} />
								{/each}
							{/if}

							<button
								class="btn btn-accent px-5 py-2.5 text-[15px] disabled:opacity-50"
								disabled={canRequireApproval && approvers.length === 0}
							>
								Save policy
							</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	{#if data.isOwner}
		<div class="card p-5">
			<div class="flex items-center justify-between">
				<p class="section-label">Invites</p>
				<form method="POST" action="?/invite" use:submit={{ success: 'Invite created' }}>
					<button class="btn btn-tint px-4 py-1.5 text-[13px]">New code</button>
				</form>
			</div>
			{#if data.invites.length === 0}
				<p class="mt-3 text-[15px]" style="color: var(--ink-3)">
					No open invites. Create a code to add someone.
				</p>
			{:else}
				<div class="mt-1">
					{#each data.invites as inv (inv.code)}
						<button
							onclick={() => copyCode(inv.code)}
							class="press hairline flex w-full items-center justify-between py-3 last:shadow-none"
						>
							<code class="font-mono text-[16px] tracking-[0.12em]" style="color: var(--ink)"
								>{inv.code}</code
							>
							<span
								class="text-[13px]"
								style="color: {copied === inv.code ? 'var(--approve)' : 'var(--ink-3)'}"
							>
								{copied === inv.code ? 'Copied ✓' : expiresIn(inv.expiresAt)}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
