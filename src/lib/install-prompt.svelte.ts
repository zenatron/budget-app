/**
 * Install affordance state — captures the browser's `beforeinstallprompt` so
 * Ledger can offer the install itself, instead of leaving Android and desktop
 * Chromium users to hunt for the omnibox icon. Safari (iOS and macOS) and
 * Firefox never fire the event; iPhone gets the Share → Add to Home Screen
 * instructions instead, which is the only lever iOS actually offers.
 *
 * A runes module like toast/confirm state: one place captures the platform's
 * one-shot event, the settings hub renders whatever state that leaves us in.
 * `dismissed` persists per device — a "Not now" that came back on every visit
 * would just train people to ignore the card.
 */
import { browser } from '$app/environment';

const DISMISS_KEY = 'install-dismissed';

/**
 * The non-standard `beforeinstallprompt` event. Chromium ships it, lib.dom
 * does not describe it, so the two members we touch are declared
 * structurally — everything else about the event stays whatever the browser
 * sent.
 */
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** iPhone/iPad Safari never fires beforeinstallprompt; its only path is A2HS. */
export function isIos(): boolean {
	if (!browser) return false;
	return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** True inside the installed app, on either platform's notion of standalone. */
export function isStandalone(): boolean {
	if (!browser) return false;
	return (
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

export const installPrompt = $state<{ available: boolean; installed: boolean; dismissed: boolean }>(
	{
		available: false,
		installed: false,
		dismissed: false
	}
);

let deferred: BeforeInstallPromptEvent | null = null;

/**
 * Called once from the root layout. Captures the (one-shot) prompt event and
 * the installed transition. Returns a cleanup for the layout's onMount.
 */
export function initInstallPrompt(): () => void {
	if (!browser) return () => {};
	installPrompt.dismissed = localStorage.getItem(DISMISS_KEY) === 'true';
	installPrompt.installed = isStandalone();

	const onBeforeInstall = (e: Event) => {
		e.preventDefault();
		deferred = e as BeforeInstallPromptEvent;
		installPrompt.available = true;
	};
	const onInstalled = () => {
		deferred = null;
		installPrompt.available = false;
		installPrompt.installed = true;
	};

	window.addEventListener('beforeinstallprompt', onBeforeInstall);
	window.addEventListener('appinstalled', onInstalled);
	return () => {
		window.removeEventListener('beforeinstallprompt', onBeforeInstall);
		window.removeEventListener('appinstalled', onInstalled);
	};
}

/** Show the platform's own install sheet. Consumes the captured event. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	if (!deferred) return 'unavailable';
	const choice = await deferred.prompt();
	deferred = null;
	installPrompt.available = false;
	return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
}

/** "Not now" — hides the card on this device until Ledger is reinstalled. */
export function dismissInstall(): void {
	installPrompt.dismissed = true;
	if (browser) localStorage.setItem(DISMISS_KEY, 'true');
}
