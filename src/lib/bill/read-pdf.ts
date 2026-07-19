/**
 * Browser-side PDF reading: text out, page images out, one load of the file.
 *
 * Runs on the client on purpose. Rendering a page needs a canvas, and the
 * browser has one — doing this on the server would mean a native canvas build
 * alongside sharp for no gain. Since pdf.js is loaded here anyway, the text
 * layer comes off the same document object for free, so the PDF itself never
 * leaves the device: only the chosen page image and the fields you confirm.
 *
 * pdf.js is ~1MB, so it is imported dynamically — this module must only ever be
 * reached from a user action, never from a page load.
 */

import type { PDFPageProxy } from 'pdfjs-dist';
import { extractBill, type BillExtraction, type TextItem } from '$lib/domain/bill/extract';

/** Long edge of the rendered page, before the server's own resize. */
const RENDER_LONG_EDGE = 2000;
/** Generous: the server re-encodes to its own WebP, so this pass shouldn't be
 *  the one that loses the small print. */
const RENDER_QUALITY = 0.92;

export interface PdfPagePreview {
	pageNumber: number;
	/** Object URL for an <img>. Revoke when the picker closes. */
	previewUrl: string;
	width: number;
	height: number;
}

export interface ReadPdfResult {
	pageCount: number;
	extraction: BillExtraction;
	/** 1-based page the winning amount was found on, for preselecting. */
	suggestedPage: number;
	pages: PdfPagePreview[];
	/** Render a page to WebP at full size, for upload. */
	renderPage: (pageNumber: number) => Promise<Blob>;
	/** Frees the preview object URLs and the worker. */
	dispose: () => void;
}

async function loadPdfjs() {
	const pdfjs = await import('pdfjs-dist');
	// Vite resolves this to a hashed asset URL at build time.
	const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	return pdfjs;
}

/** Preview strip thumbnails; small because they only have to be recognisable. */
const THUMB_LONG_EDGE = 260;

async function renderToBlob(
	page: PDFPageProxy,
	longEdge: number,
	quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
	const base = page.getViewport({ scale: 1 });
	const scale = longEdge / Math.max(base.width, base.height);
	const viewport = page.getViewport({ scale });

	const canvas = document.createElement('canvas');
	canvas.width = Math.round(viewport.width);
	canvas.height = Math.round(viewport.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas unavailable');

	// PDF pages are transparent where nothing is drawn; without this a bill
	// renders as white-on-transparent and turns into a black rectangle once
	// flattened into WebP.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	await page.render({ canvas, canvasContext: ctx, viewport }).promise;

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/webp', quality)
	);
	if (!blob) throw new Error('Could not encode page');
	return { blob, width: canvas.width, height: canvas.height };
}

export async function readPdf(
	file: File,
	opts: { dayFirst?: boolean } = {}
): Promise<ReadPdfResult> {
	const pdfjs = await loadPdfjs();
	const data = new Uint8Array(await file.arrayBuffer());

	// A PDF is an untrusted document. pdf.js 6 dropped the eval-based font path
	// that used to need disabling here, so there is no isEvalSupported to set —
	// don't reintroduce one from an older tutorial thinking it hardens anything.
	const loadingTask = pdfjs.getDocument({ data, disableAutoFetch: true });
	const doc = await loadingTask.promise;

	const items: TextItem[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const viewport = page.getViewport({ scale: 1 });
		const content = await page.getTextContent();
		for (const item of content.items) {
			if (!('str' in item) || !item.str) continue;
			// transform is [a,b,c,d,e,f]: e,f are the position and d the vertical
			// scale, which is the rendered font size. pdf.js measures y up from the
			// bottom; flip it so the extractor can reason top-down like a reader.
			const t = item.transform as number[];
			const fontSize = Math.abs(t[3]) || 10;
			items.push({
				text: item.str,
				x: t[4],
				y: viewport.height - t[5],
				width: item.width ?? item.str.length * fontSize * 0.5,
				height: item.height ?? fontSize,
				fontSize,
				page: n
			});
		}
		page.cleanup();
	}

	const metadata = await doc.getMetadata().catch(() => null);
	const metadataTitle =
		metadata && typeof metadata.info === 'object' && metadata.info
			? ((metadata.info as { Title?: string }).Title ?? null)
			: null;

	const extraction = extractBill(items, { dayFirst: opts.dayFirst, metadataTitle });

	// Previews for the page picker. Only rendered when there's a choice to make.
	const pages: PdfPagePreview[] = [];
	if (doc.numPages > 1) {
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const { blob, width, height } = await renderToBlob(page, THUMB_LONG_EDGE, 0.7);
			pages.push({ pageNumber: n, previewUrl: URL.createObjectURL(blob), width, height });
			page.cleanup();
		}
	}

	return {
		pageCount: doc.numPages,
		extraction,
		// The page carrying the figure is the page worth keeping.
		suggestedPage: extraction.total?.page ?? 1,
		pages,
		renderPage: async (pageNumber: number) => {
			const page = await doc.getPage(pageNumber);
			const { blob } = await renderToBlob(page, RENDER_LONG_EDGE, RENDER_QUALITY);
			page.cleanup();
			return blob;
		},
		dispose: () => {
			for (const p of pages) URL.revokeObjectURL(p.previewUrl);
			// The loading task owns the worker; cleanup() on the document only frees
			// page resources and would leave it running.
			void loadingTask.destroy();
		}
	};
}
