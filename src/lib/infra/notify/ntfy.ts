import type { NotificationMessage } from '$lib/ports/notifier';

export interface NtfyTargetInfo {
	serverUrl: string;
	topic: string;
}

/**
 * ntfy delivery: plain HTTP POST to {server}/{topic}. Title/Click/Tags travel
 * as headers, the body is the message text. Reliable even where Web Push
 * isn't (Safari tabs, no A2HS).
 */
export async function sendNtfy(
	target: NtfyTargetInfo,
	msg: NotificationMessage & { origin: string },
	token?: string
): Promise<boolean> {
	try {
		const res = await fetch(`${target.serverUrl.replace(/\/$/, '')}/${target.topic}`, {
			method: 'POST',
			headers: {
				Title: msg.title,
				Click: msg.origin + msg.path,
				Tags: 'moneybag',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: msg.body,
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) {
			console.log(JSON.stringify({ level: 'warn', msg: 'ntfy: send failed', status: res.status }));
		}
		return res.ok;
	} catch {
		console.log(JSON.stringify({ level: 'warn', msg: 'ntfy: send failed', status: null }));
		return false;
	}
}
