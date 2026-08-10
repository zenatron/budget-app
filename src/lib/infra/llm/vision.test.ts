import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaAssist } from './ollama-assist';
import { openaiAssist } from './openai-assist';
import { toBase64, VISION_TIMEOUT_MS, ASSIST_TIMEOUT_MS } from './prompt';
import type { ImageInput } from '$lib/ports/llm-assist';

/**
 * These assert the *shape of the request* — that an image actually reaches the
 * wire, in the form each provider expects — and the shape of what survives the
 * reply. No network: `fetch` is stubbed, in the style of model-catalog.test.ts.
 */

const IMAGE: ImageInput = { data: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/webp' };
const B64 = toBase64(IMAGE.data);

const FIELDS = {
	instruction: 'Read the bill.',
	image: IMAGE,
	fields: [
		{ key: 'total', description: 'amount due' },
		{ key: 'vendor', description: 'who issued it' }
	]
};

function stubFetch(content: unknown, shape: 'ollama' | 'openai' = 'ollama') {
	const body =
		shape === 'ollama' ? { message: { content } } : { choices: [{ message: { content } }] };
	// Typed by signature, implemented without parameters: the generic is what
	// makes `spy.mock.calls[0][1]` typed, which is the point of these tests.
	const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
		async () => new Response(JSON.stringify(body), { status: 200 })
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

function bodyOf(spy: ReturnType<typeof stubFetch>) {
	return JSON.parse(spy.mock.calls[0][1]!.body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe('ollama — the image reaches the wire', () => {
	it('puts base64 in `images` on the user turn, and asks for JSON', async () => {
		const spy = stubFetch('{"total":"12.34","vendor":"Acme"}');
		const assist = ollamaAssist({ endpoint: 'http://box:11434', model: 'gemma4' });

		await assist.readFields(FIELDS);

		expect(spy.mock.calls[0][0]).toBe('http://box:11434/api/chat');
		const body = bodyOf(spy);
		expect(body.format).toBe('json');
		expect(body.options.temperature).toBe(0);

		const user = body.messages.at(-1);
		expect(user.role).toBe('user');
		expect(user.images).toEqual([B64]);
		// The system turn carries the rules and must not carry the image.
		expect(body.messages[0].role).toBe('system');
		expect(body.messages[0].images).toBeUndefined();
	});

	it('names every requested field in the prompt', async () => {
		const spy = stubFetch('{}');
		await ollamaAssist({ endpoint: 'http://box:11434', model: 'g' }).readFields(FIELDS);

		const user = bodyOf(spy).messages.at(-1).content;
		expect(user).toContain('"total"');
		expect(user).toContain('amount due');
		expect(user).toContain('Read the bill.');
	});

	it('sends rows with a row cap', async () => {
		const spy = stubFetch('{"rows":[]}');
		await ollamaAssist({ endpoint: 'http://box:11434', model: 'g' }).readRows({
			instruction: 'Read the statement.',
			image: IMAGE,
			columns: [{ key: 'date', description: 'posting date' }],
			maxRows: 40
		});

		expect(bodyOf(spy).messages.at(-1).content).toContain('at most 40');
	});
});

describe('openai-compatible — the image reaches the wire', () => {
	it('puts a data URI in a content-parts array', async () => {
		const spy = stubFetch('{"total":"12.34"}', 'openai');
		const assist = openaiAssist({ endpoint: 'https://api.x', model: 'gpt', apiKey: 'k' });

		await assist.readFields(FIELDS);

		expect(spy.mock.calls[0][0]).toBe('https://api.x/v1/chat/completions');
		const user = bodyOf(spy).messages.at(-1);
		expect(user.content[0]).toEqual({
			type: 'text',
			text: expect.stringContaining('Read the bill.')
		});
		expect(user.content[1]).toEqual({
			type: 'image_url',
			image_url: { url: `data:image/webp;base64,${B64}` }
		});
	});

	it('leaves the system turn as a plain string, which every server accepts', async () => {
		const spy = stubFetch('{}', 'openai');
		await openaiAssist({ endpoint: 'https://api.x', model: 'g', apiKey: null }).readFields(FIELDS);

		expect(typeof bodyOf(spy).messages[0].content).toBe('string');
	});

	it('does not request a response_format many compatible servers reject', async () => {
		const spy = stubFetch('{}', 'openai');
		await openaiAssist({ endpoint: 'https://api.x', model: 'g', apiKey: null }).readFields(FIELDS);

		expect(bodyOf(spy).response_format).toBeUndefined();
	});
});

describe('what survives the reply', () => {
	it.each([
		['a bare object', '{"total":"12.34"}', { total: '12.34' }],
		['a fenced object', '```json\n{"total":"12.34"}\n```', { total: '12.34' }],
		['prose either side', 'Sure! {"total":"12.34"} Hope that helps.', { total: '12.34' }],
		// A number means the model did arithmetic on something we never saw. Our
		// parsers exist precisely so a float never gets trusted, so it is dropped
		// here rather than coerced.
		['a number instead of a string', '{"total":12.34,"vendor":"Acme"}', { vendor: 'Acme' }],
		['nested junk', '{"total":{"amount":"12"},"vendor":"Acme"}', { vendor: 'Acme' }]
	])('reads %s', async (_name, content, expected) => {
		stubFetch(content);
		const out = await ollamaAssist({ endpoint: 'http://b', model: 'g' }).readFields(FIELDS);
		expect(out).toEqual(expected);
	});

	it.each([
		['prose only', 'I could not read that image.'],
		['empty', '']
	])('returns null for %s', async (_name, content) => {
		stubFetch(content);
		const out = await ollamaAssist({ endpoint: 'http://b', model: 'g' }).readFields(FIELDS);
		expect(out).toBeNull();
	});

	it('caps rows at maxRows even when the model overruns', async () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({ date: `2026-03-0${i}` }));
		stubFetch(JSON.stringify({ rows }));

		const out = await ollamaAssist({ endpoint: 'http://b', model: 'g' }).readRows({
			instruction: 'x',
			image: IMAGE,
			columns: [{ key: 'date', description: 'd' }],
			maxRows: 3
		});

		expect(out).toHaveLength(3);
	});

	it('returns null when rows are missing entirely', async () => {
		stubFetch('{"total":"12.34"}');
		const out = await ollamaAssist({ endpoint: 'http://b', model: 'g' }).readRows({
			instruction: 'x',
			image: IMAGE,
			columns: [{ key: 'date', description: 'd' }],
			maxRows: 3
		});
		expect(out).toBeNull();
	});
});

describe('failure is always null, never a throw', () => {
	it.each([
		['a non-200', async () => new Response('nope', { status: 500 })],
		[
			'a network error',
			async () => {
				throw new Error('ECONNREFUSED');
			}
		],
		['a body that is not JSON', async () => new Response('<html>', { status: 200 })]
	])('survives %s', async (_name, impl) => {
		vi.stubGlobal('fetch', vi.fn(impl));
		const assist = ollamaAssist({ endpoint: 'http://b', model: 'g' });

		await expect(assist.readFields(FIELDS)).resolves.toBeNull();
		await expect(
			assist.readRows({ instruction: 'x', image: IMAGE, columns: [], maxRows: 1 })
		).resolves.toBeNull();
	});
});

describe('the timeout fits the work', () => {
	it('gives vision far longer than a text call', () => {
		// A 2000px page render is thousands of tokens before the model starts.
		// Timing out a call that would have worked costs the user the same as a
		// wrong answer: nothing usable.
		expect(VISION_TIMEOUT_MS).toBeGreaterThan(ASSIST_TIMEOUT_MS * 4);
	});
});

describe('toBase64', () => {
	it('round-trips, including past the chunking boundary', () => {
		const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 256);
		const decoded = Uint8Array.from(atob(toBase64(big)), (c) => c.charCodeAt(0));
		expect(decoded).toEqual(big);
	});
});
