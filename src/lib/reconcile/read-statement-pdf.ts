/**
 * Read a PDF bank statement in the browser and hand back candidate rows.
 *
 * Client-side for the same reason `$lib/bill/read-pdf` is: the statement itself
 * never leaves the device. Only the three columns pulled out of it are posted,
 * and only after a person has seen them. A bank statement is about as sensitive
 * as a household document gets — every card number, every address, every
 * transaction the ledger has nothing to do with — so uploading the file to parse
 * it server-side would be trading a real disclosure for no benefit.
 *
 * pdf.js is ~1MB and dynamically imported, so this module must only ever be
 * reached from a user action, never from a page load.
 */

import type { TextItem } from '$lib/domain/bill/extract';
import {
	extractStatementRows,
	rowsToCsv,
	type PdfExtraction
} from '$lib/domain/reconcile/parse-pdf';

export interface StatementPdfResult extends PdfExtraction {
	pageCount: number;
	/** The rows as a canonical CSV, ready to post. */
	csv: string;
}

async function loadPdfjs() {
	const pdfjs = await import('pdfjs-dist');
	// Vite resolves this to a hashed asset URL at build time.
	const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	return pdfjs;
}

export async function readStatementPdf(file: File): Promise<StatementPdfResult> {
	const pdfjs = await loadPdfjs();
	const data = new Uint8Array(await file.arrayBuffer());

	// A PDF is an untrusted document; see the note in bill/read-pdf about what
	// pdf.js 6 does and doesn't need turned off here.
	const loadingTask = pdfjs.getDocument({ data, disableAutoFetch: true });
	const doc = await loadingTask.promise;

	try {
		const items: TextItem[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const viewport = page.getViewport({ scale: 1 });
			const content = await page.getTextContent();
			for (const it of content.items) {
				if (!('str' in it) || !it.str) continue;
				// transform is [a,b,c,d,e,f]: e,f position, d the rendered font size.
				// pdf.js measures y up from the bottom; flip it so rows sort top-down
				// the way a reader goes down the page.
				const t = it.transform as number[];
				const fontSize = Math.abs(t[3]) || 10;
				items.push({
					text: it.str,
					x: t[4],
					y: viewport.height - t[5],
					width: it.width ?? it.str.length * fontSize * 0.5,
					height: it.height ?? fontSize,
					fontSize,
					page: n
				});
			}
			page.cleanup();
		}

		const extraction = extractStatementRows(items);
		return {
			...extraction,
			pageCount: doc.numPages,
			csv: rowsToCsv(extraction.rows)
		};
	} finally {
		// The loading task owns the worker; the document's own cleanup would leave
		// it running.
		void loadingTask.destroy();
	}
}
