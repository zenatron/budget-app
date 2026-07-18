import { fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { getEnv } from '$lib/server/env';
import {
	deleteNtfyTarget,
	getNtfyTarget,
	listDisabledPrefs,
	listPushSubscriptions,
	setNtfyTarget,
	setPref
} from '$lib/server/repo/notifications';
import { sendNtfy } from '$lib/infra/notify/ntfy';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import { EVENT_TYPES } from '$lib/notification-events';
import type { Actions, PageServerLoad } from './$types';

const deps = { clock: systemClock, ids: uuidv7 };

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();
	const env = getEnv();
	const [ntfy, disabled, subs] = await Promise.all([
		getNtfyTarget(db, locals.user!.id),
		listDisabledPrefs(db, [locals.member!.id]),
		listPushSubscriptions(db, [locals.user!.id])
	]);
	return {
		vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
		ntfy: ntfy
			? { topic: ntfy.topic, serverUrl: ntfy.serverUrl }
			: {
					topic: `budget-${randomBytes(6).toString('hex')}`,
					serverUrl: env.NTFY_SERVER_URL ?? 'https://ntfy.sh',
					unsaved: true
				},
		subscriptionCount: subs.length,
		disabled: disabled.map((d) => `${d.eventType}:${d.channel}`),
		eventTypes: EVENT_TYPES.map((e) => ({ ...e }))
	};
};

const NtfySchema = v.object({
	topic: v.pipe(
		v.string(),
		v.trim(),
		v.regex(/^[A-Za-z0-9_-]{4,64}$/, 'Topic: 4–64 letters, digits, - or _')
	),
	serverUrl: v.pipe(v.string(), v.trim(), v.url('Server must be a URL'))
});

export const actions: Actions = {
	ntfy: async ({ locals, request }) => {
		const parsed = v.safeParse(NtfySchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { section: 'ntfy', error: parsed.issues[0].message });
		await setNtfyTarget(getDb(), deps, {
			userId: locals.user!.id,
			topic: parsed.output.topic,
			serverUrl: parsed.output.serverUrl
		});
		return { section: 'ntfy', ok: true };
	},

	ntfyOff: async ({ locals }) => {
		await deleteNtfyTarget(getDb(), locals.user!.id);
		return { section: 'ntfy', ok: true };
	},

	ntfyTest: async ({ locals }) => {
		const target = await getNtfyTarget(getDb(), locals.user!.id);
		if (!target) return fail(400, { section: 'ntfy', error: 'Save a topic first' });
		const ok = await sendNtfy(
			target,
			{
				title: 'Budget test',
				body: 'ntfy is wired up correctly.',
				path: `/w/${locals.workspace!.slug}`,
				origin: getEnv().PUBLIC_ORIGIN
			},
			getEnv().NTFY_DEFAULT_TOKEN
		);
		return ok
			? { section: 'ntfy', ok: true, tested: true }
			: fail(502, { section: 'ntfy', error: 'The ntfy server did not accept the message' });
	},

	prefs: async ({ locals, request }) => {
		const form = await request.formData();
		const enabledKeys = new Set(form.getAll('enabled').map(String));
		const db = getDb();
		for (const event of EVENT_TYPES) {
			for (const channel of ['webpush', 'ntfy']) {
				await setPref(db, {
					memberId: locals.member!.id,
					eventType: event.id,
					channel,
					enabled: enabledKeys.has(`${event.id}:${channel}`)
				});
			}
		}
		return { section: 'prefs', ok: true };
	}
};
