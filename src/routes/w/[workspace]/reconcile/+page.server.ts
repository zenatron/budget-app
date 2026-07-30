import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listImports } from '$lib/server/repo/statements';
import {
	MAX_CSV_BYTES,
	ReconcileError,
	deleteImport,
	importStatement
} from '$lib/application/reconcile';
import { detectColumns } from '$lib/domain/reconcile/parse-csv';
import { rateLimitOk } from '$lib/server/rate-limit';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

const deps = { clock: systemClock, ids: uuidv7 };

export const load: PageServerLoad = async ({ locals, params }) => {
	// See +layout.server.ts: a locals-only load declares no dependency on the
	// workspace in the URL, so switching workspaces wouldn't re-run it.
	void params.workspace;
	const db = getDb();
	const ws = locals.workspace!;
	return {
		currency: ws.currency,
		imports: await listImports(db, ws.id)
	};
};

/** First row of a CSV, for the manual column mapper. */
function headerOf(csv: string): string[] {
	const firstLine = csv.replaceAll('\r\n', '\n').split('\n')[0] ?? '';
	// Good enough to *label* the mapper's dropdowns; the real RFC 4180 tokeniser
	// in parse-csv does the actual reading.
	return firstLine.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
}

export const actions: Actions = {
	upload: async ({ request, locals, params, getClientAddress }) => {
		// Parsing a statement is markedly more work than an ordinary form post,
		// and it's an authenticated upload — the same reason /push and image
		// uploads are limited.
		if (!rateLimitOk(`statement-import:${locals.member!.id}`, 10, 60_000)) {
			return fail(429, { error: 'Too many imports. Wait a minute and try again.' });
		}
		void getClientAddress;

		const form = await request.formData();
		const file = form.get('statement');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose a CSV file to import.' });
		}
		if (file.size > MAX_CSV_BYTES) {
			return fail(400, { error: 'That file is too large to import.' });
		}

		const csv = await file.text();

		/*
		 * Column mapping. Auto-detection handles the common exports; when it
		 * can't, the page shows a mapper and posts back with explicit columns
		 * rather than failing. The raw CSV rides along in a hidden field so the
		 * person doesn't have to pick the file a second time — it has already
		 * been read into memory and is capped above.
		 */
		const dateCol = form.get('dateCol');
		const amountCol = form.get('amountCol');
		const descriptionCol = form.get('descriptionCol');
		const explicit =
			dateCol !== null && amountCol !== null && descriptionCol !== null
				? {
						dateCol: Number(dateCol),
						amountCol: Number(amountCol),
						descriptionCol: Number(descriptionCol),
						invertAmount: form.get('invertAmount') === 'on',
						dateOrder: (form.get('dateOrder') as 'MDY' | 'DMY' | 'YMD') || 'MDY'
					}
				: undefined;

		if (!explicit && !detectColumns(headerOf(csv))) {
			// Hand the file back with its headers so the mapper can be shown.
			return fail(400, {
				needsMapping: true,
				filename: file.name,
				headers: headerOf(csv),
				csv,
				error: "Couldn't work out which columns are which. Point them out below."
			});
		}

		let importId: string;
		try {
			const result = await importStatement(
				getDb(),
				deps,
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				{
					filename: file.name,
					csv,
					currency: locals.workspace!.currency,
					map: explicit
				}
			);
			importId = result.importId;
		} catch (e) {
			if (e instanceof ReconcileError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/w/${params.workspace}/reconcile/${importId}`);
	},

	/** Re-post of the mapper: same path, with the CSV carried in the form. */
	uploadMapped: async ({ request, locals, params }) => {
		const form = await request.formData();
		const csv = String(form.get('csv') ?? '');
		const filename = String(form.get('filename') ?? 'statement.csv');
		if (!csv) return fail(400, { error: 'That file is no longer available. Choose it again.' });

		let importId: string;
		try {
			const result = await importStatement(
				getDb(),
				deps,
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				{
					filename,
					csv,
					currency: locals.workspace!.currency,
					map: {
						dateCol: Number(form.get('dateCol')),
						amountCol: Number(form.get('amountCol')),
						descriptionCol: Number(form.get('descriptionCol')),
						invertAmount: form.get('invertAmount') === 'on',
						dateOrder: (form.get('dateOrder') as 'MDY' | 'DMY' | 'YMD') || 'MDY'
					}
				}
			);
			importId = result.importId;
		} catch (e) {
			if (e instanceof ReconcileError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/w/${params.workspace}/reconcile/${importId}`);
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const importId = String(form.get('importId') ?? '');
		if (!importId) return fail(400, { error: 'Nothing to remove.' });
		await deleteImport(
			getDb(),
			deps,
			{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
			importId
		);
		return { ok: true };
	}
};
