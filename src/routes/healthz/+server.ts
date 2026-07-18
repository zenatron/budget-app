import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		await getDb().execute(sql`select 1`);
		return json({ status: 'ok' });
	} catch {
		return json({ status: 'db_unreachable' }, { status: 503 });
	}
};
