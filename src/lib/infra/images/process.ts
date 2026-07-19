import sharp from 'sharp';

/**
 * Untrusted-upload pipeline: verify magic bytes (never the client's
 * Content-Type), cap pixels before decode (decompression bombs), bake EXIF
 * orientation in with .rotate() *first*, then encode WebP — sharp drops all
 * metadata (GPS, timestamps) unless asked to keep it, which we never do.
 * Originals are discarded; only the two derivatives are stored.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000; // ~40MP
/** Bounds on the *long* edge, not on width — see `derive`. */
const DISPLAY_EDGE = 1600;
const THUMB_EDGE = 400;
const WEBP_QUALITY = 78;

export class ImageValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageValidationError';
	}
}

function sniffFormat(data: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
	if (data.length < 12) return null;
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
	if (
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return 'webp';
	}
	return null;
}

export interface Derivative {
	data: Uint8Array;
	width: number;
	height: number;
}

export interface ProcessedImage {
	display: Derivative;
	thumb: Derivative;
}

export async function processUpload(input: Uint8Array): Promise<ProcessedImage> {
	if (input.byteLength > MAX_UPLOAD_BYTES) {
		throw new ImageValidationError('Image is too large (15 MB max)');
	}
	if (sniffFormat(input) === null) {
		throw new ImageValidationError('Not a supported image (JPEG, PNG, or WebP)');
	}

	/*
	 * `fit: 'inside'` bounds the long edge, so both dimensions stay under `edge`
	 * and the aspect ratio is untouched — nothing is ever cropped here. Bounding
	 * width alone made portrait uploads the most expensive thing in the store: a
	 * phone photo came out 1600×2133, half again the pixels of the same shot held
	 * landscape. Cropping to a uniform shape is a presentation choice and belongs
	 * in CSS, where it can be changed later; these are the only copies kept.
	 */
	async function derive(edge: number): Promise<Derivative> {
		const out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
			.rotate() // bake EXIF orientation before metadata is dropped
			.resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer({ resolveWithObject: true });
		return { data: out.data, width: out.info.width, height: out.info.height };
	}

	try {
		const [display, thumb] = await Promise.all([derive(DISPLAY_EDGE), derive(THUMB_EDGE)]);
		return { display, thumb };
	} catch (e) {
		if (e instanceof ImageValidationError) throw e;
		throw new ImageValidationError('Could not decode this image');
	}
}
