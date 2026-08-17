/**
 * The untrusted-upload pipeline, as a contract.
 *
 * The limits and the error type live here rather than beside the sharp
 * implementation because they are part of the agreement, not of the mechanism:
 * a route that catches `ImageValidationError` to turn it into a 400 should not
 * have to import a native binary to name the error. That import is exactly what
 * dragged sharp — and `node:module`'s createRequire — into the browser bundle.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export class ImageValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageValidationError';
	}
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

export interface ImageProcessor {
	/** Verify, strip metadata, and produce the display and thumbnail derivatives.
	 *  Throws `ImageValidationError` for anything the user should be told about. */
	processUpload(input: Uint8Array): Promise<ProcessedImage>;
	processAvatar(input: Uint8Array): Promise<Derivative>;
}
