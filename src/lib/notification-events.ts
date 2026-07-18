/** Notification event catalogue shown on the settings page. */
export const EVENT_TYPES = [
	{ id: 'approval_requested', label: 'Approval requests for me to decide' },
	{ id: 'approval_decided', label: 'Decisions on my requests' },
	{ id: 'stale_nudge', label: 'Reminders about waiting requests' },
	{ id: 'seal_opened', label: 'Sealed purchases being revealed' },
	{ id: 'recurring_due', label: 'Recurring charges being recorded' },
	{ id: 'budget_exceeded', label: 'Budget is met or exceeded' }
] as const;

export const CHANNELS = [
	{ id: 'webpush', label: 'Push' },
	{ id: 'ntfy', label: 'ntfy' }
] as const;
