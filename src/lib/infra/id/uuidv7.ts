import type { IdGenerator } from '$lib/ports/id-generator';

/**
 * RFC 9562 UUIDv7: 48-bit unix-ms timestamp, 12-bit monotonic sequence in
 * rand_a, random rand_b. Monotonic within a process so ids generated in the
 * same millisecond still sort in creation order.
 */
export function createUuidv7Generator(nowMs: () => number = Date.now): IdGenerator {
	let lastMs = -1;
	let seq = 0;

	return {
		newId(): string {
			let ms = nowMs();
			if (ms <= lastMs) {
				seq += 1;
				if (seq > 0xfff) {
					// Sequence exhausted within this millisecond: borrow the next one.
					lastMs += 1;
					seq = 0;
				}
				ms = lastMs;
			} else {
				lastMs = ms;
				seq = 0;
			}

			const bytes = new Uint8Array(16);
			crypto.getRandomValues(bytes);

			// 48-bit big-endian timestamp
			bytes[0] = (ms / 2 ** 40) & 0xff;
			bytes[1] = (ms / 2 ** 32) & 0xff;
			bytes[2] = (ms / 2 ** 24) & 0xff;
			bytes[3] = (ms / 2 ** 16) & 0xff;
			bytes[4] = (ms / 2 ** 8) & 0xff;
			bytes[5] = ms & 0xff;
			// version 7 + 12-bit sequence
			bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
			bytes[7] = seq & 0xff;
			// RFC 4122 variant
			bytes[8] = (bytes[8] & 0x3f) | 0x80;

			const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
	};
}

export const uuidv7: IdGenerator = createUuidv7Generator();
