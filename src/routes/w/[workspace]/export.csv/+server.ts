import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { category, purchase, user, workspaceMember } from '$lib/server/db/schema';
import { visibleTo } from '$lib/server/repo/purchases';
import { Money } from '$lib/domain/money/money';
import { systemClock } from '$lib/infra/time/system-clock';
import type { RequestHandler } from './$types';

/**
 * Quote per RFC 4180, and neutralize spreadsheet formula injection: Excel and
 * Sheets execute a cell starting with = + - @ (or a leading tab/CR), so an item
 * named `=HYPERLINK(...)` would run on open. A leading apostrophe forces text.
 */
function csvField(value: string): string {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Purchase history export. Seal-filtered like every other read surface. */
export const GET: RequestHandler = async ({ locals }) => {
	const now = systemClock.now();
	const rows = await getDb()
		.select({ p: purchase, requester: user.displayName, categoryName: category.name })
		.from(purchase)
		.innerJoin(workspaceMember, eq(purchase.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.leftJoin(category, eq(purchase.categoryId, category.id))
		.where(and(eq(purchase.workspaceId, locals.workspace!.id), visibleTo(locals.member!.id, now)))
		.orderBy(asc(purchase.createdAt));

	const header = 'date,item,state,requester,category,requested,approved,final,currency,note';
	const lines = rows.map((r) => {
		const amount = (minor: bigint | null) =>
			minor === null ? '' : Money.of(minor, r.p.currency).toDecimalString();
		return [
			(r.p.completedAt ?? r.p.requestedAt ?? r.p.createdAt).toISOString().slice(0, 10),
			csvField(r.p.itemName),
			r.p.state,
			csvField(r.requester),
			csvField(r.categoryName ?? ''),
			amount(r.p.requestedAmountMinor),
			amount(r.p.approvedAmountMinor),
			amount(r.p.finalAmountMinor),
			r.p.currency,
			csvField(r.p.note ?? '')
		].join(',');
	});

	return new Response([header, ...lines].join('\n') + '\n', {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${locals.workspace!.slug}-purchases.csv"`
		}
	});
};
