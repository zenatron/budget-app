import { describe, it, expect, vi } from 'vitest';
import { readStatementPage } from './read-statement-image';
import { fakeAssist } from '$lib/ports/fake-assist';
import type { ImageInput, LlmAssist } from '$lib/ports/llm-assist';
import { rowsToCsv } from '$lib/domain/reconcile/parse-pdf';
import { detectColumns, parseCsv } from '$lib/domain/reconcile/parse-csv';

const IMAGE: ImageInput = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' };
const OPTS = { page: 1, currency: 'USD' };

describe('readStatementPage — rows', () => {
	it('reads a clean page into PdfRow shape', async () => {
		const assist = fakeAssist({
			readRows: async () => [
				{ date: '03/01/2026', amount: '-12.50', description: 'SQ *COFFEE 0042' },
				{ date: '03/02/2026', amount: '1,000.00', description: 'RENT' }
			]
		});

		const { rows } = await readStatementPage(assist, IMAGE, OPTS);

		expect(rows).toEqual([
			{ date: '2026-03-01', amount: '-12.50', description: 'SQ *COFFEE 0042', page: 1 },
			{ date: '2026-03-02', amount: '1000.00', description: 'RENT', page: 1 }
		]);
	});

	it('drops a row missing the date or the amount — those decide a match', async () => {
		const assist = fakeAssist({
			readRows: async () => [
				{ date: 'sometime', amount: '12.50', description: 'COFFEE' },
				{ date: '2026-03-02', amount: 'a lot', description: 'RENT' },
				{ date: '2026-03-03', amount: '9.99', description: 'GOOD' }
			]
		});

		const { rows } = await readStatementPage(assist, IMAGE, OPTS);
		expect(rows.map((r) => r.description)).toEqual(['GOOD']);
	});

	it('keeps a row whose description is blank — plenty of banks print a bare code', async () => {
		const assist = fakeAssist({
			readRows: async () => [{ date: '2026-03-01', amount: '12.50', description: '' }]
		});

		const { rows } = await readStatementPage(assist, IMAGE, OPTS);
		expect(rows).toEqual([{ date: '2026-03-01', amount: '12.50', description: '', page: 1 }]);
	});

	it('reads the accountants’ bracketed debit as negative', async () => {
		const assist = fakeAssist({
			readRows: async () => [{ date: '2026-03-01', amount: '(12.50)', description: 'X' }]
		});

		const { rows } = await readStatementPage(assist, IMAGE, OPTS);
		expect(rows[0].amount).toBe('-12.50');
	});

	it('honours the workspace day/month convention', async () => {
		const assist = fakeAssist({
			readRows: async () => [{ date: '03/04/2026', amount: '1.00', description: 'X' }]
		});

		expect((await readStatementPage(assist, IMAGE, { ...OPTS, dayFirst: true })).rows[0].date).toBe(
			'2026-04-03'
		);
		expect(
			(await readStatementPage(assist, IMAGE, { ...OPTS, dayFirst: false })).rows[0].date
		).toBe('2026-03-04');
	});

	it('stamps the page it came from', async () => {
		const assist = fakeAssist({
			readRows: async () => [{ date: '2026-03-01', amount: '1.00', description: 'X' }]
		});
		expect((await readStatementPage(assist, IMAGE, { ...OPTS, page: 4 })).rows[0].page).toBe(4);
	});

	it('is empty when the model returned nothing, or is off', async () => {
		expect(
			(await readStatementPage(fakeAssist({ readRows: async () => null }), IMAGE, OPTS)).rows
		).toEqual([]);

		const readRows = vi.fn(async () => [{ date: '2026-03-01', amount: '1.00', description: 'X' }]);
		const off = await readStatementPage(fakeAssist({ available: false, readRows }), IMAGE, OPTS);
		expect(off.rows).toEqual([]);
		expect(readRows).not.toHaveBeenCalled();
	});
});

describe('readStatementPage — the header is the human’s confabulation check', () => {
	it('reads it only when asked, so it costs one call not one per page', async () => {
		const readFields = vi.fn<LlmAssist['readFields']>(async () => ({ bank: 'Northwind Bank' }));
		const assist = fakeAssist({ readFields, readRows: async () => [] });

		await readStatementPage(assist, IMAGE, OPTS);
		expect(readFields).not.toHaveBeenCalled();

		const out = await readStatementPage(assist, IMAGE, { ...OPTS, withHeader: true });
		expect(readFields).toHaveBeenCalledOnce();
		expect(out.header).toEqual({ bank: 'Northwind Bank' });
	});

	it('asks only for identifying details, never for anything that decides money', async () => {
		const readFields = vi.fn<LlmAssist['readFields']>(async () => null);
		await readStatementPage(fakeAssist({ readFields }), IMAGE, { ...OPTS, withHeader: true });

		expect(readFields.mock.calls[0][0].fields.map((f) => f.key)).toEqual([
			'bank',
			'account',
			'period'
		]);
	});
});

describe('readStatementPage — rejoins the existing pipeline untouched', () => {
	it('produces rows that go through rowsToCsv and parseCsv like any other', async () => {
		const assist = fakeAssist({
			readRows: async () => [
				{ date: '03/01/2026', amount: '-12.50', description: 'SQ *COFFEE 0042' },
				{ date: '03/02/2026', amount: '-1,000.00', description: 'RENT' }
			]
		});

		const { rows } = await readStatementPage(assist, IMAGE, OPTS);
		const csv = rowsToCsv(rows);
		const headers = csv.split('\n')[0].split(',');
		const cols = detectColumns(headers);
		expect(cols).not.toBeNull();

		const parsed = parseCsv(csv, 'USD', { ...cols!, dateOrder: 'YMD' });
		expect(parsed.lines.map((l) => l.amountMinor)).toEqual([-1250n, -100000n]);
		expect(parsed.lines[0].rawDescription).toBe('SQ *COFFEE 0042');
	});
});
