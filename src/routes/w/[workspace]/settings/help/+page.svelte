<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * The app's rules in one place. Written against how it actually behaves —
	 * several of these (sealing hiding totals, the approver conflict, recurring
	 * bypassing approval) are deliberate decisions that are impossible to infer
	 * from the UI alone.
	 */
	let slug = $derived(page.params.workspace);

	// Empty states link straight to the answer, e.g. …/settings/help?s=buckets.
	// A query param rather than a #fragment on purpose: a fragment makes the
	// browser scroll to the element itself, before any of this runs, so the
	// first section scrolled the heading off screen for no reason.
	//
	// Opened imperatively rather than binding `open`, so a reactive value can't
	// fight the reader by snapping sections shut again.
	$effect(() => {
		const id = page.url.searchParams.get('s') ?? '';
		if (!id) return;
		const el = document.getElementById(id);
		if (!(el instanceof HTMLDetailsElement)) return;
		el.open = true;
		// Measured after the expansion has been laid out — reading the rect in the
		// same tick returns zeros, which made every section look on-screen.
		requestAnimationFrame(() => {
			// Scroll only when the opened section doesn't fit as it stands. The top
			// ones sit right under the heading and already fit, so scrolling to
			// those just shoved "How this works" off screen to gain nothing.
			const { top, bottom } = el.getBoundingClientRect();
			const needsRoom = bottom > window.innerHeight && top > 100;
			if (top < 0 || needsRoom) {
				el.scrollIntoView({ block: 'start', behavior: 'smooth' });
			}
		});
	});

	const sections = [
		// Ordered to mirror the nav — Wallet, Activity, Plan (recurring then
		// buckets, matching its sub-tabs), Income — so the section you want sits
		// where the tab you were just on sits. This is scanned, not read.
		{
			id: 'logging',
			icon: 'card',
			title: 'Logging vs asking',
			body: [
				'**Log it** records something you already bought. **Ask first** requests permission before you spend.',
				'Which one needs approval is set per person in Settings → Members. If your policy says no approval is needed, "Ask first" is approved the moment you submit it.'
			]
		},
		{
			id: 'approvals',
			icon: 'checkmark',
			title: 'Approvals',
			body: [
				'A policy is either **never**, **above an amount**, or **always**. You also name who can decide — any one of them, or one specific person.',
				'Approval is not symmetric: being someone’s approver and needing approval yourself are independent settings.',
				'**Spending more than approved sends it back.** If the final amount is well over what was approved, the purchase returns to waiting until the approver confirms the real price.',
				'Editing the item, amount or category of an approved purchase also sends it back — unless it never needed approval, in which case the change just applies.'
			]
		},
		{
			id: 'gift',
			icon: 'gift',
			title: 'Gift mode',
			body: [
				'Hides a purchase from the people you pick, until a date you choose.',
				'It is hidden **everywhere** — the list, search, the detail page, and every total on Activity. Their spending figures are computed as if it does not exist, so nothing can be worked out by subtraction.',
				'Only the person who created it can reveal it early. It opens automatically on the chosen date.',
				'If the only person who could approve it is also the person it is hidden from, it is approved automatically **and the audit trail says so** — it is never silently skipped.'
			]
		},
		{
			id: 'budgets',
			icon: 'chart',
			title: 'Budgets & Activity',
			body: [
				'Budgets are monthly, set overall or per category, and can be scheduled up to a year ahead — useful when you know a month will be different.',
				'Setting a new budget does not rewrite past months. Each month keeps the budget that applied at the time.',
				'You get a notification when a budget passes 80% and again when it is exceeded.',
				'Swipe the card on Activity to move between periods.'
			]
		},
		{
			id: 'recurring',
			icon: 'repeat',
			title: 'Recurring charges',
			body: [
				'Rent, subscriptions, bills. Each rule generates purchases on its own schedule.',
				'**Record automatically** posts them as already-paid at the set amount. Leave it off and each one waits for you to confirm what was actually charged.',
				'Recurring purchases do not go through approval — the decision was made when you created the rule.',
				'If the app is offline for a while, missed occurrences are generated when it comes back.'
			]
		},
		{
			id: 'buckets',
			icon: 'bank',
			title: 'Buckets',
			body: [
				'A bucket sets money aside each month — a travel fund, a new laptop, an emergency float. It adds its monthly amount on the day you choose.',
				'Buckets belong to the person who made them. Only that person can withdraw or adjust one.',
				'You can charge a purchase to a bucket, which draws it down. The workspace can be set so bucket charges skip approval entirely.'
			]
		},
		{
			id: 'income',
			icon: 'dollar',
			title: 'Income',
			body: [
				'Add what comes in, either as a one-off or as a monthly amount on a chosen day.',
				'A monthly entry is a template, not a stack of records — the occurrences are worked out when you look, so editing it corrects every month at once.',
				'Income is visible to everyone in the workspace. Unlike purchases, it cannot be hidden.',
				'It drives the net position on Activity: what came in, minus what went out and what you set aside.'
			]
		},
		{
			id: 'palette',
			icon: 'sparkle',
			title: 'Asking questions',
			body: [
				'The sparkle in the header takes plain language: *how much did I spend on groceries last month*, *what’s my net position*, *add income of 4800 per month on the first*.',
				'It shows what it understood as you type. If it cannot act on something, it says what is missing rather than guessing.',
				'Nothing leaves your server — it is pattern matching, not an AI service.'
			]
		}
	];

	/** Minimal **bold** and *italic* so the copy above stays readable as prose. */
	function render(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--ink)">$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>');
	}
</script>

<svelte:head><title>Help — Ledger</title></svelte:head>

<div class="mx-auto max-w-lg space-y-4">
	<a
		href="/w/{slug}"
		class="press -ml-1 inline-flex items-center gap-0.5 text-[14px] font-medium"
		style="color: var(--ink-3)"
	>
		<Icon name="chevronLeft" class="h-4 w-4" /> Settings
	</a>

	<div class="px-1">
		<h1 class="text-[28px]">How Ledger works</h1>
		<p class="mt-1.5 text-[15px] leading-relaxed" style="color: var(--ink-3)">
			The rules worth knowing, including the few that aren't obvious from the screens.
		</p>
	</div>

	<div class="space-y-2">
		{#each sections as s (s.id)}
			<details id={s.id} class="card overflow-hidden">
				<summary
					class="press flex cursor-pointer list-none items-center gap-3.5 p-4 [&::-webkit-details-marker]:hidden"
				>
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
						style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
					>
						<Icon name={s.icon} class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
					</span>
					<span class="flex-1 text-[16px] font-medium" style="color: var(--ink)">{s.title}</span>
					<Icon name="chevronDown" class="chevron h-4 w-4" style="color: var(--ink-4)" />
				</summary>
				<div class="space-y-2.5 px-4 pb-4" style="padding-left: 4.25rem">
					{#each s.body as para (para)}
						<p class="text-[14px] leading-relaxed" style="color: var(--ink-2)">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html render(para)}
						</p>
					{/each}
				</div>
			</details>
		{/each}
	</div>

	<p class="px-1 pt-2 text-[13px] leading-relaxed" style="color: var(--ink-4)">
		Every number on Activity is filtered to what you're allowed to see, so two people can look at
		the same screen and correctly see different totals.
	</p>
</div>

<style>
	/* :global — the class is handed to <Icon>, so the scope hash never lands
	   on the element that actually renders it. Still bounded to this component
	   by the `details` prefix. */
	details :global(.chevron) {
		transition: transform var(--dur-fast) var(--ease-out);
	}
	details[open] :global(.chevron) {
		transform: rotate(180deg);
	}
</style>
