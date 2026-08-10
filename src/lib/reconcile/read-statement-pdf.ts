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
	/**
	 * True when the document carried no usable text at all — a photocopy or a
	 * photographed statement. The text path has nothing to work with, and this is
	 * the one case where asking a model to look at the page adds something no
	 * amount of better parsing could.
	 */
	isScanned: boolean;
	/**
	 * Render pages to JPEG for a model to read. Only called on the scanned path,
	 * and only after a person has asked for it: rasterising every page of a
	 * statement is real work on a phone.
	 */
	renderPages: (limit: number) => Promise<File[]>;
	/**
	 * Releases the pdf.js worker. The document is deliberately kept open past the
	 * return so `renderPages` can use it without re-parsing the file, which means
	 * the caller — not this function — owns the end of its life.
	 */
	dispose: () => void;
}

async function loadPdfjs() {
	const pdfjs = await import('pdfjs-dist');
	// Vite resolves this to a hashed asset URL at build time.
	const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	return pdfjs;
}

/** Long edge for a page a model has to read small print off. */
const RENDER_LONG_EDGE = 2000;
const RENDER_QUALITY = 0.92;

/**
 * A page with essentially no text is a picture of a page. The threshold is
 * deliberately low rather than zero: a scan often carries a stray character or
 * two of OCR noise, or a text-layer page number stamped on by the scanner, and
 * treating that as "this document has text" would send a photocopied statement
 * down a path that can only fail.
 */
const SCANNED_TEXT_CHARS = 40;

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
		const textChars = items.reduce((n, it) => n + it.text.trim().length, 0);

		/**
		 * Rasterise the first `limit` pages. Kept as a closure over the still-open
		 * document so the file is parsed once — the alternative is re-reading it
		 * from the user's disk to render what we have already loaded.
		 */
		async function renderPages(limit: number): Promise<File[]> {
			const out: File[] = [];
			for (let n = 1; n <= Math.min(doc.numPages, limit); n++) {
				const page = await doc.getPage(n);
				const base = page.getViewport({ scale: 1 });
				const scale = RENDER_LONG_EDGE / Math.max(base.width, base.height);
				const viewport = page.getViewport({ scale });

				const canvas = document.createElement('canvas');
				canvas.width = Math.round(viewport.width);
				canvas.height = Math.round(viewport.height);
				const ctx = canvas.getContext('2d');
				if (!ctx) throw new Error('Canvas unavailable');
				// PDF pages are transparent where nothing is drawn; without this a
				// statement flattens to a black rectangle.
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				await page.render({ canvas, canvasContext: ctx, viewport }).promise;

				const blob = await new Promise<Blob | null>((resolve) =>
					canvas.toBlob(resolve, 'image/jpeg', RENDER_QUALITY)
				);
				page.cleanup();
				if (blob) out.push(new File([blob], `page-${n}.jpg`, { type: 'image/jpeg' }));
			}
			return out;
		}

		return {
			...extraction,
			pageCount: doc.numPages,
			csv: rowsToCsv(extraction.rows),
			isScanned: textChars < SCANNED_TEXT_CHARS,
			renderPages,
			dispose: () => void loadingTask.destroy()
		};
	} catch (e) {
		// Nothing to hand back, so nothing needs the document any more.
		void loadingTask.destroy();
		throw e;
	}
}
