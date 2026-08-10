import { describe, it, expect, vi } from 'vitest';
import { readDocumentImage } from './read-document-image';
import { fakeAssist } from '$lib/ports/fake-assist';
import type { ImageInput, LlmAssist } from '$lib/ports/llm-assist';

const IMAGE: ImageInput = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' };
const USD = { kind: 'bill' as const, currency: 'USD' };

describe('readDocumentImage', () => {
	it('types a clean transcription', async () => {
		const assist = fakeAssist({
			readFields: async () => ({
				total: '$1,240.50',
				vendor: 'Acme Utilities',
				dueDate: '2026-03-14'
			})
		});

		expect(await readDocumentImage(assist, IMAGE, USD)).toEqual({
			totalMinor: 124050n,
			vendor: 'Acme Utilities',
			dueDate: '2026-03-14'
		});
	});

	it('keeps the fields that read and drops the ones that did not', async () => {
		const assist = fakeAssist({
			readFields: async () => ({
				total: '1240.50',
				vendor: '',
				dueDate: 'sometime next month'
			})
		});

		expect(await readDocumentImage(assist, IMAGE, USD)).toEqual({ totalMinor: 124050n });
	});

	it('never returns a figure the model narrated rather than copied', async () => {
		const assist = fakeAssist({
			readFields: async () => ({ total: 'about twelve hundred dollars' })
		});
		expect(await readDocumentImage(assist, IMAGE, USD)).toEqual({});
	});

	it('is empty when the model could not answer', async () => {
		expect(
			await readDocumentImage(fakeAssist({ readFields: async () => null }), IMAGE, USD)
		).toEqual({});
	});

	it('asks nothing at all when the assist is off', async () => {
		const readFields = vi.fn(async () => ({ total: '10.00' }));
		const out = await readDocumentImage(fakeAssist({ available: false, readFields }), IMAGE, USD);

		expect(out).toEqual({});
		expect(readFields).not.toHaveBeenCalled();
	});

	it('honours the workspace date convention', async () => {
		const assist = fakeAssist({ readFields: async () => ({ dueDate: '03/04/2026' }) });

		expect((await readDocumentImage(assist, IMAGE, { ...USD, dayFirst: true })).dueDate).toBe(
			'2026-04-03'
		);
		expect((await readDocumentImage(assist, IMAGE, { ...USD, dayFirst: false })).dueDate).toBe(
			'2026-03-04'
		);
	});

	it('tells a receipt from a bill, since the misreads differ', async () => {
		const readFields = vi.fn<LlmAssist['readFields']>(async () => null);
		await readDocumentImage(fakeAssist({ readFields }), IMAGE, { ...USD, kind: 'receipt' });

		const req = readFields.mock.calls[0][0];
		// A receipt's characteristic misread is the cash tendered, not a subtotal.
		expect(req.instruction).toContain('not the cash tendered');
		expect(req.instruction).toContain('receipt');
		expect(req.fields.find((f) => f.key === 'dueDate')!.description).toContain('date of purchase');
	});

	it('tells the model what "total" means on a bill, and to leave blanks blank', async () => {
		const readFields = vi.fn<LlmAssist['readFields']>(async () => null);
		await readDocumentImage(fakeAssist({ readFields }), IMAGE, USD);

		const req = readFields.mock.calls[0][0];
		expect(req.instruction).toContain('not a subtotal');
		expect(req.instruction).toContain('leave it blank');
		expect(req.fields.map((f) => f.key)).toEqual(['total', 'vendor', 'dueDate']);
		expect(req.image).toBe(IMAGE);
	});
});
