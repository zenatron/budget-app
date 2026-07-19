import { building } from '$app/environment';
import { error, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { runMigrations } from '$lib/server/db/migrate';
import { getEnv } from '$lib/server/env';
import {
	SESSION_COOKIE,
	clearSessionCookie,
	createSession,
	setActiveWorkspace,
	setSessionCookie,
	validateSession
} from '$lib/server/auth/session';
import { findWorkspaceForMember } from '$lib/server/repo/workspaces';
import { rateLimitOk } from '$lib/server/rate-limit';
import { unsealDuePurchases } from '$lib/application/unseal-due';
import { nudgeStaleRequests } from '$lib/application/nudge-stale';
import { materializeDueRules } from '$lib/application/recurring';
import { checkBudgetAlerts } from '$lib/application/budget-alerts';
import { materializeBucketAccruals } from '$lib/application/buckets';
import { systemClock } from '$lib/infra/time/system-clock';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { getNotifier } from '$lib/server/notify';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const init: ServerInit = async () => {
	if (building) return;
	const env = getEnv(); // fail fast on bad configuration
	await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
	console.log(JSON.stringify({ level: 'info', msg: 'boot: migrations up to date' }));

	// A sweep that outruns its interval must not stack: overlapping runs race each
	// other over the same due rows and each one holds a pool connection.
	let sweeping = false;
	const sweep = async () => {
		if (sweeping) {
			console.log(JSON.stringify({ level: 'warn', msg: 'sweep: skipped, previous still running' }));
			return;
		}
		sweeping = true;
		try {
			await runSweep();
		} finally {
			sweeping = false;
		}
	};

	const runSweep = async () => {
		const deps = { clock: systemClock, ids: uuidv7, notifier: getNotifier() };
		try {
			const opened = await unsealDuePurchases(getDb(), deps);
			if (opened > 0) {
				console.log(JSON.stringify({ level: 'info', msg: 'sweep: seals opened', count: opened }));
			}
		} catch (e) {
			console.log(
				JSON.stringify({ level: 'error', msg: 'sweep: unseal failed', err: (e as Error).message })
			);
		}
		try {
			const made = await materializeDueRules(getDb(), deps);
			if (made > 0) {
				console.log(
					JSON.stringify({ level: 'info', msg: 'sweep: recurring generated', count: made })
				);
			}
		} catch (e) {
			console.log(
				JSON.stringify({
					level: 'error',
					msg: 'sweep: recurring failed',
					err: (e as Error).message
				})
			);
		}
		try {
			const nudged = await nudgeStaleRequests(getDb(), deps);
			if (nudged > 0) {
				console.log(JSON.stringify({ level: 'info', msg: 'sweep: nudges sent', count: nudged }));
			}
		} catch (e) {
			console.log(
				JSON.stringify({ level: 'error', msg: 'sweep: nudge failed', err: (e as Error).message })
			);
		}
		try {
			const alerts = await checkBudgetAlerts(getDb(), deps);
			if (alerts > 0) {
				console.log(
					JSON.stringify({ level: 'info', msg: 'sweep: budget alerts sent', count: alerts })
				);
			}
		} catch (e) {
			console.log(
				JSON.stringify({
					level: 'error',
					msg: 'sweep: budget alerts failed',
					err: (e as Error).message
				})
			);
		}
		try {
			const accrued = await materializeBucketAccruals(getDb(), deps);
			if (accrued > 0) {
				console.log(
					JSON.stringify({ level: 'info', msg: 'sweep: bucket accruals', count: accrued })
				);
			}
		} catch (e) {
			console.log(
				JSON.stringify({
					level: 'error',
					msg: 'sweep: bucket accrual failed',
					err: (e as Error).message
				})
			);
		}
	};
	await sweep();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => void sweep().finally(schedule), SWEEP_INTERVAL_MS);
	};
	schedule();

	// Without this the pending timer keeps the process alive past SIGTERM and
	// the container waits out Docker's 10s kill timeout on every deploy.
	const shutdown = () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);
};

const WORKSPACE_PATH = /^\/w\/([^/]+)(?:\/|$)/;

/**
 * Single authorization layer: resolves session → user → (for /w/ routes)
 * workspace membership onto locals. Routes never re-derive any of this.
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Abuse damping: auth endpoints per IP, image uploads per session.
	if (event.url.pathname.startsWith('/auth/')) {
		if (!rateLimitOk(`auth:${event.getClientAddress()}`, 10, 60_000)) {
			error(429, 'Too many attempts — wait a minute');
		}
	}
	if (event.request.method === 'POST' && event.url.search.includes('/addImage')) {
		const key = `upload:${event.cookies.get('sid') ?? event.getClientAddress()}`;
		if (!rateLimitOk(key, 30, 3_600_000)) {
			error(429, 'Too many uploads — try again later');
		}
	}

	event.locals.user = null;
	event.locals.session = null;
	event.locals.workspace = null;
	event.locals.member = null;

	const sid = event.cookies.get(SESSION_COOKIE);
	if (sid) {
		// Shape-check before the lookup: ids are base64url from randomBytes(32),
		// so anything else is junk and shouldn't cost a database round trip.
		const wellFormed = sid.length <= 128 && /^[A-Za-z0-9_-]+$/.test(sid);
		const hit = wellFormed ? await validateSession(getDb(), sid) : null;
		if (hit) {
			event.locals.user = hit.user;
			event.locals.session = hit.session;
			// Keep the cookie's expiry in step with sliding renewal.
			setSessionCookie(event.cookies, hit.session.id, hit.session.expiresAt);
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	// Dev mode bypass: auto-create user + session when Pocket ID isn't running.
	const env = getEnv();
	if (env.DEV_MODE && !event.locals.user) {
		const devSub = 'dev-user';
		const now = systemClock.now();
		const [existing] = await getDb()
			.select()
			.from(user)
			.where(eq(user.oidcSubject, devSub))
			.limit(1);
		let devUser;
		if (existing) {
			devUser = existing;
			await getDb().update(user).set({ lastLoginAt: now }).where(eq(user.id, existing.id));
		} else {
			[devUser] = await getDb()
				.insert(user)
				.values({
					id: uuidv7.newId(),
					oidcSubject: devSub,
					email: env.DEV_USER_EMAIL,
					displayName: env.DEV_USER_NAME,
					createdAt: now,
					lastLoginAt: now
				})
				.returning();
		}
		const sess = await createSession(getDb(), devUser.id, {
			userAgent: event.request.headers.get('user-agent'),
			ip: event.getClientAddress()
		});
		event.locals.user = devUser;
		event.locals.session = sess;
		setSessionCookie(event.cookies, sess.id, sess.expiresAt);
		// If on the landing page, redirect to welcome so the user can set up.
		if (event.url.pathname === '/') redirect(303, '/welcome');
	}

	const match = WORKSPACE_PATH.exec(event.url.pathname);
	if (match) {
		if (!event.locals.user) redirect(303, '/');
		const ctx = await findWorkspaceForMember(getDb(), match[1], event.locals.user.id);
		// 404, not 403: don't reveal which workspace slugs exist.
		if (!ctx) error(404, 'Not found');
		event.locals.workspace = ctx.workspace;
		event.locals.member = ctx.member;
		if (event.locals.session && event.locals.session.activeWorkspaceId !== ctx.workspace.id) {
			await setActiveWorkspace(getDb(), event.locals.session.id, ctx.workspace.id);
		}
	}

	return resolve(event);
};
