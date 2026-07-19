/**
 * Barcode decoding, entirely on the device.
 *
 * Two engines behind one call. `BarcodeDetector` is built into Chromium and is
 * the better one — hardware-backed, no download — but Safari has never shipped
 * it, and this app is used as an iPhone PWA, so a WASM decoder has to carry
 * that case. Roughly a megabyte, therefore imported dynamically: this module
 * must only ever be reached from a user opening the scanner, never from a page
 * load.
 *
 * Nothing here talks to a network. A barcode is a record of what someone is
 * buying, and deciding to send that anywhere is a separate decision from being
 * able to read it.
 */

/** The symbologies retail products actually carry. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] as const;

/** zxing spells them differently. */
const ZXING_FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF'] as const;

export interface ScanHit {
	/** The digits. */
	value: string;
	/** Symbology as reported by whichever engine read it. */
	format: string;
}

type NativeDetector = {
	detect: (source: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]>;
};

interface DetectorCtor {
	new (opts: { formats: readonly string[] }): NativeDetector;
	getSupportedFormats?: () => Promise<string[]>;
}

function nativeCtor(): DetectorCtor | null {
	const w = globalThis as unknown as { BarcodeDetector?: DetectorCtor };
	return w.BarcodeDetector ?? null;
}

export function hasNativeDetector(): boolean {
	return nativeCtor() !== null;
}

/**
 * A decoder bound to whichever engine this browser has.
 *
 * Created once and reused across frames — constructing a detector or booting
 * the WASM module per frame would cost more than the decode.
 */
export async function createDecoder(): Promise<{
	engine: 'native' | 'wasm';
	decode: (frame: ImageData | Blob) => Promise<ScanHit[]>;
}> {
	const Ctor = nativeCtor();
	if (Ctor) {
		// Ask what it actually supports: the constructor accepts formats it may
		// then ignore, and an unsupported list throws on some builds.
		let formats: readonly string[] = FORMATS;
		try {
			const supported = (await Ctor.getSupportedFormats?.()) ?? [];
			if (supported.length > 0) {
				const usable = FORMATS.filter((f) => supported.includes(f));
				if (usable.length > 0) formats = usable;
			}
		} catch {
			/* fall through to the default list */
		}
		const detector = new Ctor({ formats });
		return {
			engine: 'native',
			decode: async (frame) => {
				const source =
					frame instanceof Blob ? await createImageBitmap(frame) : await createImageBitmap(frame);
				try {
					const found = await detector.detect(source);
					return found.map((f) => ({ value: f.rawValue, format: f.format }));
				} finally {
					source.close?.();
				}
			}
		};
	}

	const [{ prepareZXingModule, readBarcodes }, wasmUrl] = await Promise.all([
		import('zxing-wasm/reader'),
		import('zxing-wasm/reader/zxing_reader.wasm?url').then((m) => m.default)
	]);
	// Vite hashes the wasm as an asset; point the module's loader at that URL
	// rather than letting it guess a path relative to the bundle.
	prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

	return {
		engine: 'wasm',
		decode: async (frame) => {
			const results = await readBarcodes(frame, {
				formats: [...ZXING_FORMATS],
				// Retail labels are printed square-on and the viewfinder is small;
				// trying harder costs frames we would rather spend on the next one.
				tryHarder: false,
				maxNumberOfSymbols: 1
			});
			return results
				.filter((r) => r.isValid !== false && r.text)
				.map((r) => ({ value: r.text, format: String(r.format) }));
		}
	};
}

/**
 * A barcode read twice in a row is a barcode. One read once is often a smear of
 * shelf edge that happened to satisfy a checksum — the cost of a false positive
 * is a wrong product silently filled into a form, so it is worth a few frames.
 */
export class Confirmer {
	#last: string | null = null;
	#count = 0;
	constructor(private readonly needed = 2) {}

	/** Returns the value once it has been seen `needed` times running. */
	offer(value: string): string | null {
		if (value === this.#last) {
			this.#count += 1;
		} else {
			this.#last = value;
			this.#count = 1;
		}
		return this.#count >= this.needed ? value : null;
	}

	reset() {
		this.#last = null;
		this.#count = 0;
	}
}

/**
 * EAN/UPC carry a check digit. Verifying it locally costs nothing and rejects
 * the misreads that survive a single decode.
 */
export function isValidEanUpc(code: string): boolean {
	if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
	const digits = code.split('').map(Number);
	const check = digits.pop()!;
	// Weights alternate 3,1 from the rightmost body digit leftwards.
	const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
	return (10 - (sum % 10)) % 10 === check;
}
