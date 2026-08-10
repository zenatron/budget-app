/**
 * Read a document that is a picture rather than text — a scanned bill, or a
 * photograph of a receipt.
 *
 * The deterministic extractor (`domain/bill/extract`) works on a PDF's text
 * layer. A scan has none — it is a photograph of a page — so until now the bill
 * importer dead-ended there with "there's no text to read". The image, however,
 * was already in hand: `read-pdf` renders every page to WebP at 2000px in order
 * to attach one to the purchase. The picture we tell the user we can't read is
 * sitting in memory at the moment we say it.
 *
 * So this is the one thing a model can do here that nothing else can: look at
 * the page. What it may do with that is deliberately tiny — it transcribes three
 * named fields as strings, and `coerceFields` runs each through the app's own
 * parsers. The model is never asked what the bill *means*, never asked to total
 * anything, and never handed a number back to us as a number.
 *
 * What comes out lands in the same Add Purchase form a person was going to fill
 * in anyway, with the same Use-before-anything-moves step the text path has.
 * Every field is independently droppable: a bill whose total reads cleanly and
 * whose date doesn't yields the total and an empty date, which is strictly
 * better than the empty form it replaces.
 */

import type { ImageInput, LlmAssist } from '$lib/ports/llm-assist';
import { coerceFields } from '$lib/domain/intelligence/read-fields';

/**
 * The two things a person photographs on the way to logging a purchase. They
 * want the same three fields off the page and differ only in what the page is
 * called and which figure counts, so they share every line of machinery below
 * and split on one instruction.
 */
export type DocumentKind = 'bill' | 'receipt';

export interface DocumentReading {
	/** Minor units, having survived `parseAmount` and `Money`. */
	totalMinor?: bigint;
	vendor?: string;
	/** ISO calendar day. A day, not an instant — see `coerceDate`. */
	dueDate?: string;
}

const FIELDS = [
	{ key: 'total', kind: 'money' },
	{ key: 'vendor', kind: 'text' },
	{ key: 'dueDate', kind: 'date' }
] as const;

/**
 * Instructions written for a small local model, which is what most people
 * running this will point at it. Each names the fields, says which figure counts
 * — the commonest misread on a bill is a subtotal, and on a receipt it's a
 * line item or the cash tendered — and repeats the two rules that matter: copy,
 * and leave blank rather than guess.
 */
const INSTRUCTIONS: Record<DocumentKind, string> = {
	bill:
		'This is a photograph or scan of a single bill or invoice. ' +
		'Read three things off it: the total amount payable now, the name of the ' +
		'business that issued it, and the date payment is due. ' +
		'For the total, use the final amount due — not a subtotal, not a previous ' +
		'balance, not a line item. ' +
		'Copy each value exactly as printed. If one is not clearly visible, leave it blank.',
	receipt:
		'This is a photograph of a shop or restaurant receipt. ' +
		'Read three things off it: the total actually paid, the name of the shop or ' +
		'restaurant, and the date of the purchase. ' +
		'For the total, use the final total paid — not a subtotal, not a single ' +
		'line item, not the cash tendered or the change given. ' +
		'Copy each value exactly as printed. If one is not clearly visible, leave it blank.'
};

const DESCRIPTIONS: Record<DocumentKind, { total: string; vendor: string }> = {
	bill: { total: 'total amount payable, digits as printed', vendor: 'business name' },
	receipt: { total: 'total paid, digits as printed', vendor: 'shop or restaurant name' }
};

export async function readDocumentImage(
	assist: LlmAssist,
	image: ImageInput,
	opts: { kind: DocumentKind; currency: string; dayFirst?: boolean }
): Promise<DocumentReading> {
	if (!assist.available) return {};

	const desc = DESCRIPTIONS[opts.kind];
	const raw = await assist.readFields({
		instruction: INSTRUCTIONS[opts.kind],
		image,
		fields: [
			{ key: 'total', description: desc.total },
			{ key: 'vendor', description: desc.vendor },
			{
				key: 'dueDate',
				description:
					opts.kind === 'bill' ? 'date payment is due, as printed' : 'date of purchase, as printed'
			}
		]
	});

	const fields = coerceFields(raw, FIELDS, opts);
	return {
		...(fields.total !== undefined ? { totalMinor: fields.total } : {}),
		...(fields.vendor !== undefined ? { vendor: fields.vendor } : {}),
		...(fields.dueDate !== undefined ? { dueDate: fields.dueDate } : {})
	};
}
