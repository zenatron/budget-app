import { and, eq, count as drizzleCount } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { category, purchase } from '$lib/server/db/schema';
import { systemClock } from '$lib/infra/time/system-clock';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import type { Actions, PageServerLoad } from './$types';

const CreateSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(60)),
	icon: v.pipe(v.string(), v.trim(), v.minLength(1, 'Pick an icon'))
});

const UpdateSchema = v.object({
	id: v.pipe(v.string(), v.uuid()),
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(60)),
	icon: v.optional(v.pipe(v.string(), v.trim()))
});

export const load: PageServerLoad = async ({ locals, params }) => {
	void params.workspace;
	const db = getDb();
	const rows = await db
		.select()
		.from(category)
		.where(and(eq(category.workspaceId, locals.workspace!.id), eq(category.isArchived, false)))
		.orderBy(category.isBuiltIn, category.name);

	const builtIn: { id: string; name: string; icon: string | null; purchases: number }[] = [];
	const custom: typeof builtIn = [];

	for (const r of rows) {
		const [cnt] = await db
			.select({ n: drizzleCount() })
			.from(purchase)
			.where(eq(purchase.categoryId, r.id));
		const entry = { id: r.id, name: r.name, icon: r.icon, purchases: Number(cnt?.n ?? 0) };
		if (r.isBuiltIn) builtIn.push(entry);
		else custom.push(entry);
	}

	return { builtIn, custom, isOwner: locals.member!.role === 'owner' };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403);
		const parsed = v.safeParse(CreateSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });

		const { name, icon } = parsed.output;
		const db = getDb();

		const [existing] = await db
			.select({ id: category.id })
			.from(category)
			.where(
				and(
					eq(category.workspaceId, locals.workspace!.id),
					eq(category.name, name),
					eq(category.isArchived, false)
				)
			)
			.limit(1);
		if (existing) return fail(400, { error: 'A category with that name already exists.' });

		await db.insert(category).values({
			id: uuidv7.newId(),
			workspaceId: locals.workspace!.id,
			name,
			icon: icon || null,
			isBuiltIn: false
		});
		return { ok: true };
	},

	update: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403);
		const parsed = v.safeParse(UpdateSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });

		const { id, name, icon } = parsed.output;
		const db = getDb();

		const [row] = await db.select().from(category).where(eq(category.id, id)).limit(1);
		if (!row) return fail(404, { error: 'Category not found.' });
		if (row.isBuiltIn) return fail(403, { error: 'Built-in categories cannot be renamed.' });

		if (icon !== undefined) {
			await db.update(category).set({ name, icon }).where(eq(category.id, id));
		} else {
			await db.update(category).set({ name }).where(eq(category.id, id));
		}
		return { ok: true };
	},

	remove: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403);
		const fd = await request.formData();
		const id = fd.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing category id.' });

		const db = getDb();
		const [row] = await db.select().from(category).where(eq(category.id, id)).limit(1);
		if (!row) return fail(404, { error: 'Category not found.' });
		if (row.isBuiltIn) return fail(403, { error: 'Built-in categories cannot be removed.' });

		const [used] = await db
			.select({ n: drizzleCount() })
			.from(purchase)
			.where(eq(purchase.categoryId, id));

		if (Number(used?.n ?? 0) > 0) {
			await db.update(category).set({ isArchived: true }).where(eq(category.id, id));
		} else {
			await db.delete(category).where(eq(category.id, id));
		}
		return { ok: true };
	}
};
