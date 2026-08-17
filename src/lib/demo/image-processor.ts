import {
	ImageValidationError,
	MAX_AVATAR_BYTES,
	MAX_UPLOAD_BYTES,
	type Derivative,
	type ImageProcessor,
	type ProcessedImage
} from '$lib/ports/image-processor';

/**
 * The upload pipeline, done with canvas instead of sharp.
 *
 * Same contract and the same refusals, so a receipt photo behaves in the demo
 * the way it does in the app. Two properties the server version has come free
 * here: decoding through `createImageBitmap` applies EXIF orientation, and
 * drawing to a canvas keeps only pixels — GPS and timestamps cannot survive the
 * round trip, which is the point of the server's `.rotate()`-then-re-encode.
 *
 * The pixel cap still matters: a decompression bomb would otherwise be decoded
 * at full size in the visitor's tab.
 */
const MAX_INPUT_PIXELS = 40_000_000;
const DISPLAY_EDGE = 1600;
const THUMB_EDGE = 400;
const WEBP_QUALITY = 0.78;

/** Magic bytes, never the file's claimed type — same check the server makes. */
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

async function decode(input: Uint8Array): Promise<ImageBitmap> {
	if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
		throw new ImageValidationError('This browser cannot process images in the demo.');
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(new Blob([input as BlobPart]));
	} catch {
		throw new ImageValidationError('That image could not be read');
	}
	if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) {
		bitmap.close();
		throw new ImageValidationError('Image resolution is too large');
	}
	return bitmap;
}

/** Fit inside `edge` on the long side, never scaling up. */
async function derive(bitmap: ImageBitmap, edge: number): Promise<Derivative> {
	const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = new OffscreenCanvas(width, height);
	const g = canvas.getContext('2d');
	if (!g) throw new ImageValidationError('That image could not be read');
	g.drawImage(bitmap, 0, 0, width, height);

	const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
	return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export function createCanvasImageProcessor(): ImageProcessor {
	return {
		async processUpload(input: Uint8Array): Promise<ProcessedImage> {
			if (input.byteLength > MAX_UPLOAD_BYTES) {
				throw new ImageValidationError('Image is too large (15 MB max)');
			}
			if (sniffFormat(input) === null) {
				throw new ImageValidationError('Not a supported image (JPEG, PNG, or WebP)');
			}
			const bitmap = await decode(input);
			try {
				return {
					display: await derive(bitmap, DISPLAY_EDGE),
					thumb: await derive(bitmap, THUMB_EDGE)
				};
			} finally {
				bitmap.close();
			}
		},

		async processAvatar(input: Uint8Array): Promise<Derivative> {
			if (input.byteLength > MAX_AVATAR_BYTES) {
				throw new ImageValidationError('Photo is too large (10 MB max)');
			}
			if (sniffFormat(input) === null) {
				throw new ImageValidationError('Not a supported image (JPEG, PNG, or WebP)');
			}
			const bitmap = await decode(input);
			try {
				return await derive(bitmap, THUMB_EDGE);
			} finally {
				bitmap.close();
			}
		}
	};
}
