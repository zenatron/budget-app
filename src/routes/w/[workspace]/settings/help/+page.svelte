<script lang="ts">
	import { page } from '$app/state';
	import {
		ChevronLeft,
		ChevronDown,
		CreditCard,
		Check,
		Bell,
		Gift,
		Moon,
		ChartNoAxesColumnIncreasing,
		Repeat,
		Landmark,
		CircleDollarSign,
		Users,
		Sparkles
	} from '@lucide/svelte';
	const HELP_ICONS = {
		card: CreditCard,
		checkmark: Check,
		bell: Bell,
		gift: Gift,
		moon: Moon,
		chart: ChartNoAxesColumnIncreasing,
		repeat: Repeat,
		bank: Landmark,
		dollar: CircleDollarSign,
		people: Users,
		sparkle: Sparkles
	};

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
		// Ordered to mirror the nav — Ledger, Activity, Plan (recurring then
		// buckets, matching its sub-tabs), Income — so the section you want sits
		// where the tab you were just on sits. This is scanned, not read.
		{
			id: 'logging',
			icon: 'card',
			title: 'Logging vs asking',
			body: [
				'**Log it** records something you already bought. **Ask first** requests permission before you spend.',
				'Logging something from a while ago? Set **When** to the day it happened — it lands in that month’s figures, not today’s.',
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
			id: 'needs',
			icon: 'bell',
			title: 'What needs you',
			body: [
				'Two kinds of thing can be waiting on you, and both sit at the top of the Ledger and add up on one card in Settings, so nothing slips down the list.',
				'**Awaiting a decision** — purchases waiting for an approver to say yes or no.',
				'**Confirm what you paid** — purchases that are approved but have no final amount yet: a recurring bill set to ask you, or a request you had approved for an estimate. Only you can confirm your own. Open one to enter what you were actually charged, and on which date.',
				'These are dated by when they happened, not when they landed, so an older one shows its real month rather than today — and they’re listed oldest first, so you clear the backlog in order.'
			]
		},
		{
			id: 'sleep',
			icon: 'moon',
			title: 'Sleep on it',
			body: [
				'Not sure about a purchase? Put it to sleep instead of deciding now. The request pauses for a set time, then comes back so you can decide with a clearer head — a gentle guard against impulse buys.',
				'On a request that’s waiting, tap **Sleep on it** and choose how long. The length is suggested from the amount — bigger buys wait a bit longer — and you can spin the dial to change it. Either the person who asked or an approver can start a pause.',
				'While it’s asleep it can’t be approved or bought, and it shows on the Ledger under **Sleeping on it** with a countdown. You can wake it early or let it go at any time.',
				'When the time is up it’s marked **Ready to decide** and you get a reminder. From there it’s **Buy it** (back in the approval queue), **a few more days**, or **let it go** — and changing your mind is a perfectly good outcome.'
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
				'Swipe the card on Activity to move between periods.',
				'Tap any category or person in a breakdown to open just those purchases in the Ledger, already filtered to the period you were looking at. You can also filter the Ledger yourself by date, person or category.'
			]
		},
		{
			id: 'recurring',
			icon: 'repeat',
			title: 'Recurring charges',
			body: [
				'Rent, subscriptions, bills. Each rule generates purchases on its own schedule.',
				'**Record automatically** posts them as already-paid at the set amount. Leave it off — for a bill that changes each month — and each one lands under **Confirm what you paid** at the top of the Ledger, waiting for you to enter the real figure.',
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
				'You can charge a purchase to a bucket, which draws it down. The workspace has a default for whether bucket charges skip approval, and each person’s policy can override it — always skip, or always require — for their own charges.'
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
			id: 'members',
			icon: 'people',
			title: 'Members & roles',
			body: [
				'Everyone is an **owner** or a **member**. Owners change workspace settings, budgets, invites and everyone’s approval policy; members do everything else.',
				'Any owner can make another person an owner, or step someone — including themselves — back down to member, as long as one owner is always left. Promote first, then demote yourself: that’s how you hand a workspace over.',
				'**Disable** someone to take away their access without erasing their history; **restore** brings them back. You can’t disable yourself, the last owner, or the only person left who can approve someone else’s spending.',
				'**Deleting the workspace** removes everything in it and cannot be undone — it makes you type the name to confirm.'
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
		<ChevronLeft class="h-4 w-4" /> Settings
	</a>

	<div class="px-1">
		<h1 class="text-[28px]">How Ledger works</h1>
		<p class="mt-1.5 text-[15px] leading-relaxed" style="color: var(--ink-3)">
			New here? Everything you need to get going.
		</p>
	</div>

	<div class="space-y-2">
		{#each sections as s (s.id)}
			{@const SIcon = HELP_ICONS[s.icon as keyof typeof HELP_ICONS]}
			<details id={s.id} class="card overflow-hidden">
				<summary
					class="press flex cursor-pointer list-none items-center gap-3.5 p-4 [&::-webkit-details-marker]:hidden"
				>
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
						style="background: color-mix(in oklab, var(--ws-accent) 18%, transparent)"
					>
						<SIcon class="h-[18px] w-[18px]" style="color: var(--ws-accent)" />
					</span>
					<span class="flex-1 text-[16px] font-medium" style="color: var(--ink)">{s.title}</span>
					<ChevronDown class="chevron h-4 w-4" style="color: var(--ink-4)" />
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
