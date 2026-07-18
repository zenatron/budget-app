import { createCompositeNotifier } from '$lib/infra/notify/composite';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Notifier } from '$lib/ports/notifier';
import { getDb } from '$lib/server/db';
import { getEnv } from '$lib/server/env';

let instance: Notifier | undefined;

export function getNotifier(): Notifier {
	if (!instance) {
		const env = getEnv();
		const webPush =
			env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
				? {
						publicKey: env.VAPID_PUBLIC_KEY,
						privateKey: env.VAPID_PRIVATE_KEY,
						subject:
							env.VAPID_SUBJECT ??
							(env.PUBLIC_ORIGIN.startsWith('https:')
								? env.PUBLIC_ORIGIN
								: 'mailto:admin@example.com')
					}
				: null;
		if (!webPush) {
			console.log(
				JSON.stringify({ level: 'warn', msg: 'notify: web push disabled (no VAPID keys)' })
			);
		}
		instance = createCompositeNotifier(getDb(), systemClock, {
			origin: env.PUBLIC_ORIGIN,
			webPush,
			ntfyToken: env.NTFY_DEFAULT_TOKEN
		});
	}
	return instance;
}
